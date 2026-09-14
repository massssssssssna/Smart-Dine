# Real-Time Kitchen Display Synchronization

## Overview
SmartDine routes dining table and takeaway tickets to kitchen display units using optimistic UI updates backed by PostgreSQL row versioning.

## Event Pipeline
1. Cashier or Waiter commits order items.
2. Status transitions to `in_progress`.
3. Kitchen staff acknowledge ticket preparation.
4. Auto-timestamps recorded on `prepared_at`.
