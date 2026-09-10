# API guide

Base URL: `http://127.0.0.1:8000/api/v1`. Interactive Swagger: `/docs`. The adjacent `openapi.json` is the generated frontend contract, including all request schemas.

Use login to obtain a Supabase access token, then send `Authorization: Bearer <access_token>`. Mutations declaring `Idempotency-Key` require a unique 8–128 character key; reuse that key only for an identical retry. Versioned changes require the latest `expected_version`. Lists use limit/offset. Decimal money is represented as strings. Errors include code, message and request_id; validation errors do not echo input.

Managers administer users, recipes, menu changes, financial reports, forecasts, assistant and approvals. Staff use operational orders, menu, inventory and expense entry. Public access is limited to authentication and token-based feedback.

Order workflow: create pending order, optionally edit, transition to preparing (stock deduction), ready, then completed (paid sale). Fetch updated versions after every change. Feedback is issued for completed orders. Forecast jobs require six complete months; import CSV text using the documented history request schema and explicitly close verified operating days.

| Method | Path | Operation |
|---|---|---|
| GET | `/health/live` | Live |
| GET | `/health/ready` | Ready |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Refresh |
| GET | `/api/v1/auth/me` | Me |
| POST | `/api/v1/auth/logout` | Logout |
| POST | `/api/v1/auth/password` | Change Password |
| GET | `/api/v1/users` | List Users |
| POST | `/api/v1/users` | Create User |
| GET | `/api/v1/users/{user_id}` | Get User |
| PUT | `/api/v1/users/{user_id}` | Update User |
| GET | `/api/v1/menu` | List Menu |
| POST | `/api/v1/menu` | Create Menu Item |
| GET | `/api/v1/menu/{item_id}` | Get Menu Item |
| PUT | `/api/v1/menu/{item_id}` | Update Menu Item |
| GET | `/api/v1/recipes/{menu_item_id}` | Get Recipe |
| PUT | `/api/v1/recipes/{menu_item_id}` | Replace Recipe |
| GET | `/api/v1/orders` | List Orders |
| POST | `/api/v1/orders` | Create Order |
| GET | `/api/v1/orders/{order_id}` | Get Order |
| PUT | `/api/v1/orders/{order_id}` | Update Order |
| POST | `/api/v1/orders/{order_id}/status` | Transition Order |
| GET | `/api/v1/inventory/ingredients` | List Ingredients |
| POST | `/api/v1/inventory/ingredients` | Create Ingredient |
| GET | `/api/v1/inventory/ingredients/{ingredient_id}` | Get Ingredient |
| PUT | `/api/v1/inventory/ingredients/{ingredient_id}` | Update Ingredient |
| GET | `/api/v1/inventory/transactions` | List Transactions |
| POST | `/api/v1/inventory/transactions` | Record Transaction |
| GET | `/api/v1/expenses` | List Expenses |
| POST | `/api/v1/expenses` | Create Expense |
| GET | `/api/v1/expenses/{expense_id}` | Get Expense |
| POST | `/api/v1/expenses/{expense_id}/void` | Void Expense |
| POST | `/api/v1/reviews/submit` | Submit Review |
| POST | `/api/v1/reviews/tokens` | Issue Review Token |
| GET | `/api/v1/reviews` | List Reviews |
| GET | `/api/v1/reviews/analysis` | List Review Analysis |
| GET | `/api/v1/reviews/{review_id}` | Get Review |
| GET | `/api/v1/analytics/{report}` | Get Report |
| GET | `/api/v1/forecasts` | List Forecasts |
| POST | `/api/v1/forecasts/runs` | Enqueue |
| GET | `/api/v1/forecasts/jobs` | Jobs |
| POST | `/api/v1/forecasts/jobs/{job_id}/retry` | Retry |
| POST | `/api/v1/forecasts/history/import` | History |
| POST | `/api/v1/forecasts/day-close` | Close Day |
| POST | `/api/v1/assistant/questions` | Ask |
| GET | `/api/v1/assistant/runs` | Runs |
| GET | `/api/v1/recommendations` | List Recommendations |
| POST | `/api/v1/recommendations` | Create Recommendation |
| GET | `/api/v1/recommendations/{recommendation_id}` | Get Recommendation |
| POST | `/api/v1/recommendations/generate` | Generate Recommendations |
| POST | `/api/v1/recommendations/{recommendation_id}/approve` | Approve Recommendation |
| POST | `/api/v1/recommendations/{recommendation_id}/apply` | Apply Recommendation |
| POST | `/api/v1/recommendations/{recommendation_id}/reject` | Reject Recommendation |
| GET | `/api/v1/audit` | List Audit Events |
| GET | `/api/v1/audit/{event_id}` | Get Audit Event |