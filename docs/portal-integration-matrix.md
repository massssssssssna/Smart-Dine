# SmartDine AI - Portal Export Integration Matrix

| Portal | Scope Flag | Role Verification | Data Boundaries | Primary Format Options |
| :--- | :--- | :--- | :--- | :--- |
| **Manager** | `scope=manager` | `role == 'manager'` | Full restaurant branch history | PDF (Landscape A4), Excel (3 sheets) |
| **Cashier** | `scope=cashier` | `role == 'manager' \|\| staff_type == 'cashier'` | Complete restaurant billing history | PDF (Landscape A4), Excel (3 sheets) |
| **Waiter** | `scope=waiter` | `role == 'manager' \|\| staff_type == 'waiter'` | Orders where `created_by == actor.id` | PDF (Landscape A4), Excel (3 sheets) |
| **Kitchen** | `scope=kitchen` | `role == 'manager' \|\| staff_type == 'kitchen'` | Kitchen dispatch history (zero financials) | PDF (Landscape A4), Excel (3 sheets) |

## Frontend Toolbar Controls:
- **Preset Options**:
  - Manager: `Today`, `Last 7 days`, `Last 30 days`, `All (6 Mo)`, `Custom range`
  - Cashier / Waiter / Kitchen: `Today`, `Last 7 days`, `Last 21 days`, `Last 30 days`, `Custom range`
- **Timezone Sync**:
  Browser client displays the current active date window in formatted `Asia/Karachi` dates.
