# Daily Coverage Ledger

## Closing Process
- At the end of each operational day (02:00 PKT), the manager closes the day ledger.
- Status is set to `complete` with verified sales and void reconciliation.
- Locked days prevent retroactive order modification.

## Override Auditing
Any administrative adjustment to closed days logs timestamp, user ID, and justification note into `private.audit_logs`.

## Shift Alert UI
Unclosed ledger days display an amber status pill on the manager dashboard navigation bar.
