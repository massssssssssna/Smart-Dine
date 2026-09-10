# Verification — 9 September 2026

- Python/API suite: **69 passed**. Ruff: **all checks passed**.
- Three migrations replayed successfully in a disposable local PostgreSQL 18 database.
- SQL invariants passed: staff restrictions, costs, stock, order transitions, feedback, forecasting/job behavior and approvals.
- Additional scenarios passed: financial totals including delivery, reports, recommendation generation, numeric audit lookup, session revocation and concurrent stock/idempotency requests.
- All three migrations applied successfully to hosted Supabase. Hosted permission checks deny anonymous command execution and authenticated service execution.
- Hosted checks confirm all 24 private tables have RLS enabled. The final performance advisor has no missing foreign-key indexes.
- Live local HTTP checks: health 200, Swagger 200, unauthenticated orders 401, readiness 503 as expected without the admin key. Exported OpenAPI describes 43 paths.
- Security advisor reported informational private tables without policies, consistent with the intentional deny-all table design. Missing foreign-key indexes were added in the third migration.

Reproduce from `backend`:

```powershell
uv run pytest -q
uv run ruff check app scripts tests
# Requires your isolated local PostgreSQL server; default localhost:55432.
uv run python scripts/test_database.py
uv run python scripts/validate_config.py --live
```

The database harness creates and drops only its own uniquely named local database. Its Auth shim validates SQL behavior, not the real GoTrue lifecycle. Do not run fixtures against production.

## Remaining credential-dependent checks

`SUPABASE_SECRET_KEY` and `GROQ_API_KEY` are blank. Consequently real manager provisioning, authenticated end-to-end calls, live worker processing and Groq generation remain unverified. CLI credential retrieval was unavailable because this machine has no Supabase CLI login. Disable/verify the hosted Auth signup setting in the dashboard; the database independently rejects unmanaged account creation.

The API starts locally; readiness intentionally returns 503 until the server credential is configured. Docker configuration is supplied but a Docker build has not been verified. Statistical tests can emit harmless statsmodels warnings on all-zero data.
