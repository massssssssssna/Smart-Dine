# Shared implementation contract

This is an implementation coordination document, not user-facing setup instructions.

Python 3.12, FastAPI, Pydantic v2. Supabase owns Auth. All money JSON values use decimal strings. Core SQL in private schema with public SECURITY INVOKER wrappers. Whitelisted dispatch, never interpolated SQL from input.

## Root-owned Python interfaces
- `app.core.config.get_settings()` -> Settings with supabase_url, supabase_publishable_key, supabase_secret_key, groq_api_key (secret fields are SecretStr), groq_assistant_model, groq_review_model, app_timezone, currency, job_poll_seconds, job_lease_seconds, cors_origins.
- `app.core.exceptions.AppError(code: str, message: str, status_code: int=400)`.
- `app.api.dependencies.get_actor` -> Actor(id: UUID, role: Literal['manager','staff'], full_name: str, access_token: str excluded from repr/serialization). `require_manager` dependency returns Actor. `get_gateway` returns user gateway authenticated with Actor token. `get_admin_gateway` returns secret gateway. Dependency injection must be overrideable in tests.
- `app.integrations.supabase_client.Gateway`: async `read(resource: str, params: dict | None=None)`, `command(operation: str, payload: dict, idempotency_key: str)`, `service(operation: str, payload: dict | None=None)`. Returns decoded JSON. Serializes Decimal, UUID, dates via Pydantic JSON encoder. User RPCs `sd_read(p_resource,p_params)`, `sd_command(p_operation,p_payload,p_idempotency_key)`; service RPC `sd_service(p_operation,p_payload)`.
- Gateway also exposes `.client` as request-scoped supabase AsyncClient for Auth SDK operations.
- Root owns main.py, core/, dependencies.py, integrations/, api/v1/router.py, pyproject.toml, infra/docs/scripts. Agents do not edit these.

## Ownership and database dispatch
- Database agent owns core migration, supabase/tests, SQL contracts documentation. Define `private.read_core`, `private.command_core`, `private.service_core` and public wrappers. Dispatch unrecognized intelligence operations to `private.read_intelligence`, `private.command_intelligence`, `private.service_intelligence`; safe rejecting stubs can be replaced in second migration.
- API agent owns all modules except forecasts and assistant; reviews router may delegate analysis through SQL jobs. All routers export `router`. API agent writes tests/api and coordinates operation names with database agent.
- Intelligence agent owns intelligence/, jobs/, modules/forecasts/, modules/assistant/, tests/unit intelligence, and second intelligence SQL migration. It supplies `private.*_intelligence` implementations called by core dispatch. Coordinate table contracts with database agent.

## Common SQL contracts
- `private.profiles`: id uuid -> auth.users, email text, full_name text, role text ('manager','staff'), is_active boolean default false, version integer, created_at/updated_at timestamptz.
- `private.require_actor(p_manager boolean default false) returns uuid`: checks auth.uid, active profile, manager if required; errors SQLSTATE 42501. `private.audit(p_actor uuid,p_action text,p_entity text,p_id uuid,p_before jsonb,p_after jsonb) returns void`.
- SQL validation errors: 22023 invalid request (422), P0002 missing (404), 23505/40001 conflict (409), 42501 forbidden (403).
- `sd_read('me',{})` returns active profile. `sd_read('profile',{})` same for get_actor; unauthenticated rejected.
- `sd_read` + `sd_command` authenticated only; `sd_service` service_role only. Core must check service role from request JWT role / request DB role even if direct private entry call. No role claims from user_metadata.
- List reads return `{items: [...], total: integer, limit: integer, offset: integer}`. Single-resource reads with id return object or P0002.
- Normal mutation idempotency is atomically handled by core wrapper for all commands, including intelligence commands. Database agent defines request record/locking and expected-version conflicts.
- Core table interfaces for intelligence: menu_items(id,name,category,selling_price,packaging_cost,is_active,version,...); orders(id,status,completed_at,cancelled_at,...); order_items(order_id,menu_item_id,quantity,price_snapshot,ingredient_cost_snapshot,packaging_cost_snapshot,discount_allocated,fee_allocated,...); reviews(id,order_id,menu_item_id,rating,comment,created_at,...). All costs line totals except price_snapshot and packaging_cost_snapshot per unit. Confirm deviations by messaging peers.
- read_core resources: profile/me, users, menu, recipes, orders, inventory, inventory_transactions, expenses, analytics, reviews, recommendations, audit. command_core operations must be communicated to API agent.
- Core review submit is service-only, validates hashed expiring single-use token and inserts review + intelligence job in same transaction. Core calls private.enqueue_job(p_kind text,p_payload jsonb,p_dedup_key text,p_actor uuid) supplied by intelligence migration; rejecting stub before second migration.
- Core service admin operations bootstrap_manager, activate_user: receive verified actor_id only from root server after role check; SQL rechecks profiles for activate_user. Bootstrap locks and prohibits rerun after initial success; cannot remove last active manager.

## Requirements
Single restaurant PKR/Asia-Karachi. Preparation deducts stock atomically, cancellation never double-deducts/restocks, immutable ingredient breakdown, correct loss timing. No LLM-written SQL. Review+forecast jobs leased with fencing token. All service-generated AI output writes secret-only. Tests must cover actual invariants, not simply mirror code.
