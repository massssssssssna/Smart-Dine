# Floors, tables and order numbers

Activated locally on 10 September 2026 with migration `20260910185358_floor_tables.sql`.

- Manager: open **Tables** in the sidebar. Add, rename or delete floors; select a floor to add, edit, move or delete tables. Each table has a name and 1–100 seats. Floor summaries show table and seat totals.
- Floor names are unique within a branch; table names are unique within a floor, ignoring case and surrounding spaces. A floor containing tables cannot be deleted. A table with an active order cannot be deleted.
- Waiter: select **Floor**, then **Table** when taking an order. Options display the manager's table names and seat counts. Table assignment is required for new orders when the branch has configured tables. Older integrations without a floor plan remain compatible.
- Orders receive a database-generated unique number such as `SD-100001`. Numbers may contain gaps; they are never reused. The underlying UUID remains the API identifier. Manager search finds the number across all pages, and the bill and paid receipt use the same number.
- Orders snapshot the floor name, table name and seat count. Later floor/table edits or deletion do not rewrite historical receipts. Seating is capacity information, not a reservation or occupancy-lock system.

## API

All endpoints are under `/api/v1`. Floors/tables can be read by managers and waiters; only managers may mutate them. All database access is restricted to the caller's branch.

| Method | Route | Body / query |
|---|---|---|
| GET | `/floors` | `limit`, `offset` |
| POST | `/floors` | `name` |
| PUT | `/floors/{id}` | `name`, `expected_version` |
| DELETE | `/floors/{id}` | `expected_version` |
| GET | `/tables` | `floor_id`, `limit`, `offset` |
| POST | `/tables` | `floor_id`, `name`, `seats` |
| PUT | `/tables/{id}` | `floor_id`, `name`, `seats`, `expected_version` |
| DELETE | `/tables/{id}` | `expected_version` |

Mutations require `Idempotency-Key`. Orders accept `table_id`; `GET /orders?q=SD-100001` searches persisted order identity and table details. Swagger at `/docs` includes the updated contracts.

Verification: 63 database/API checks passed, plus frontend typecheck. A temporary branch exercised browser floor/table creation, editing and deletion, waiter floor/table selection, manager order-number search and cashier payment with the matching receipt. Test data was removed afterward.
