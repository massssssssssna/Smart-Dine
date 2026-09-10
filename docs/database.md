# Database

The three versioned migrations in `supabase/migrations` are applied to project `azpfnqmjamvcanacxayq`. All 24 business tables live in `private` with RLS enabled and no direct client table grants. Absence of permissive policies is intentional: table access is denied. Authenticated clients use `sd_read` and `sd_command`; only the server role can execute `sd_service`. Private routines check active identity, current role, session revocation and expected record versions.

Orders move pending → preparing → ready → completed, or cancel before completion. Preparation locks ingredient rows in a consistent order and snapshots consumption/costs atomically. Cancellation after preparation records a loss without restocking. Purchases update weighted-average cost. Financial reports use immutable snapshots, completed sales and dated losses; purchases are not operating expenses. Monetary values use decimal arithmetic and reconcile allocated discounts/fees.

Idempotency binds the caller, operation and payload; a reused key with changed content is rejected. Recommendation approval and application are separate version-checked transactions. Marketing and reorder recommendations remain manual tasks. Generated recommendations currently use auditable `rules-v1` rules.

Feedback tokens are expiring and single-use. Historical imports retain explicit daily coverage and cannot fabricate financial sales. Worker jobs use persisted leases, fencing and bounded retries. External AI calls occur outside database transactions.

Create future changes with `supabase migration new <name>`; never modify applied SQL. Run the isolated replay harness before applying. Hosted and local migration versions are aligned. Foreign-key indexes cover the advisor findings; unused-index notices are expected on an empty project.

The Supabase [RLS-without-policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is informational for this intentionally denied private-table design.
