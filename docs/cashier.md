# Cashier / Billing

Managers can select **Cashier / Billing (Payments & Receipts)** when creating or editing a staff account. The account remains a staff account in the manager's branch. Sign-in reads the current profile and routes it to `/cashier`.

The cashier sees Unpaid, Paid and All bills, with pagination and a search over the current page. A bill preview shows the original item prices, quantity, discount, tax and total. A pending/preparing bill may be printed with a clear UNPAID label. Once the order is ready, the cashier enters the full cash received and confirms payment. Partial payments and refunds are not supported. The change due is calculated from the stored order total.

Payment atomically moves the order from ready to completed, records the collecting account, cash and change, and writes the audit event. Idempotent retries do not collect twice; different simultaneous requests cannot both succeed. Waiter and kitchen staff cannot mark an order paid through either payment or status endpoints. Cashiers cannot create/edit orders or access menu, inventory, staff, expenses, analytics or audit endpoints. Only their own branch's bills and receipts are visible.

Print bill / Print receipt opens the browser print dialog. The print stylesheet formats a 76 mm receipt and removes navigation and payment controls. An unpaid bill is never labelled PAID. Printing itself does not record payment. Receipt number and line-item snapshots remain stable when menu prices later change.

APIs:

- `GET /api/v1/orders/bills?payment_status=unpaid|paid|all&limit=50&offset=0`
- `GET /api/v1/orders/{id}/receipt`
- `POST /api/v1/orders/{id}/pay`, with an Idempotency-Key and body `{ "expected_version": 3, "cash_received": "1000" }`

Apply `supabase/migrations/20260910114914_cashier_billing.sql` before starting the updated API. This migration adds the cashier station, payment fields and database permissions. Existing completed orders remain paid; historical cash/change fields are blank when that information was not previously recorded.

The current-profile response advertises `cashier_billing_enabled` after migration. The staff form exposes the cashier option and the waiter payment button is removed only when that capability is present, so an incomplete rollout does not interrupt the existing payment workflow.

Activated on the local restaurant database on 10 September 2026 and restarted the backend. All five database tests passed, including cashier restrictions, branch isolation and concurrent payment protection. A temporary branch verified real browser login, unpaid bills, cash collection (PKR 1,000 received against PKR 870), PKR 130 change, the paid list and receipt-only print output through the running frontend and API. Temporary accounts and orders were removed afterward. Physical printer output was not tested.

The manager can now select **Cashier / Billing** when adding or editing staff. Cashiers sign in through the normal sign-in page and are routed to `/cashier`.
