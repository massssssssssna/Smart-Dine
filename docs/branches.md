# Branches and account ownership

The running application uses native local PostgreSQL (`DATABASE_URL`), not the older hosted Supabase project. The versioned SQL directory is retained for database migrations.

Inventory now tracks bottles and packaged drinks in whole pieces. Creating a drink adds a stock record and a linked order-menu entry atomically. Receipts increase the count; preparation consumes one piece per ordered drink, with transaction locks and idempotent retries. Pending cancellations use no stock; cancellation after preparation keeps the issued bottles counted as used. Damaged/missing quantities are recorded separately. Existing kitchen recipes are retained as historical definitions but no longer constrain preparation or deduct raw ingredients. Kitchen dishes remain available without stock counts. Financial reports flag incomplete costing for sales whose food costs or drink purchase costs were not recorded.

Each manager owns one branch. A new manager created by the database owner receives a separate branch automatically when their profile becomes `role='manager'`. Existing restaurant data remains in the original branch. Menu names may repeat across branches. Orders, inventory, recipes, expenses, reviews, daily coverage, forecasts, jobs, assistant evidence and audits are branch scoped.

The staff portal can create/update only `role='staff'`, with a waiter or kitchen assignment. Manager profiles are excluded from staff lists; manager creation, promotion, editing, password resets and deletion through staff endpoints are denied. Staff inherit their manager's branch. The API does not accept a caller-supplied branch assignment.

To create another manager as the database owner, run from the project root:

```powershell
& backend/.venv/Scripts/python.exe backend/scripts/create_branch_manager.py
```

This script writes directly to the configured database and prompts for credentials without displaying the password. It is not exposed through the web application. The equivalent database workflow is to create a managed `auth.users` record with a bcrypt password hash, then promote its `private.profiles` row to manager and activate it. The profile trigger creates its branch. Do not copy an existing branch ID to a new manager.

`DELETE /api/v1/users/{id}` permanently removes a staff profile, authentication record and sessions, but preserves order/stock/expense/audit history. Historical staff foreign keys become null; an audit event records the deletion. Only staff in the caller's branch can be deleted. Repeating deletion returns an error because the account no longer exists.

`DELETE /api/v1/menu/{id}` requires an `Idempotency-Key` header and `{ "expected_version": 1 }` body using the current version. It removes the dish from menu lists and new orders while retaining its historical record. Dishes in pending, preparing or ready orders cannot be deleted until those orders finish or are cancelled. The original idempotency key can be retried safely. Only the branch manager can delete a dish.

Database RPC execution uses the non-login `sd_branch_executor` role with row-level security. Composite foreign keys prevent references to another branch. Direct business-table access remains revoked for client roles. Background service calls derive their branch from stored actor/job/item/review records; only the internal job claim operation scans the shared queue. Database administrators remain trusted and can inspect all branches.

Migration CLI generation was unavailable on this Windows runtime (missing Supabase binary package); the timestamped migration was saved locally and verified by replay in a disposable PostgreSQL database.

Verification: set `SMARTDINE_TEST_DSN` to a localhost administrative test database connection, then run `backend/.venv/Scripts/python.exe -m pytest backend/tests/database/test_branch_isolation.py`. The test creates and removes a disposable database; it never adds demo branches to the live restaurant.
