# Assistant Evidence & Tool Validation Schema

## Migration Overview
`20260916000000_assistant_evidence_tools.sql` expands the `private.service_intelligence` evidence check
to support all 9 operational read tools:
- sales_and_margins
- inventory_status
- customer_reviews
- demand_forecasts
- operating_expenses
- menu_catalog
- recent_orders
- manager_recommendations
- staff_roster

## Migration Details
- Expands table-level constraints on `private.assistant_evidence`.
- Supports null run_id for conversational small-talk messages.

## Stock Status Filtering
Only ingredients linked to active menu items (`is_active = true`) are evaluated for low-stock warnings.
