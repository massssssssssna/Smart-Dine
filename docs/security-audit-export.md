# SmartDine AI - Export Security & Data Masking Audit

## 1. CSV / Formula Injection Mitigation (CWE-1236)
When exporting user-controlled textual fields (such as guest notes, cashier discount reasons, staff names, and table names) to Microsoft Excel `.xlsx` spreadsheets, formula injection vulnerabilities can allow malicious formula execution if a spreadsheet software interprets cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r`.

### Implementation:
Every string cell value passes through `sanitize_excel_cell()`:
```python
def sanitize_excel_cell(val: Any) -> Any:
    if isinstance(val, str) and val.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + val
    return val
```

## 2. Kitchen Station Financial Isolation
Kitchen Display Systems (KDS) and back-of-house tablets operate in high-traffic shared environments. To prevent wage and financial leakage:
- In `kitchen` export scope, all monetary fields (`subtotal`, `tax`, `discount`, `total`, `unit_price`) are strictly masked to `"N/A"`.
- Table columns for price, tax, and bill amounts are omitted from the Kitchen PDF and Excel worksheets.
- Cashier attribution details are excluded from culinary dispatch records.
