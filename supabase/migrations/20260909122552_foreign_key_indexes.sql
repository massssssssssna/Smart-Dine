-- Index referencing columns used by account administration and audit lookups.
create index audit_logs_actor_id_idx on private.audit_logs(actor_id);
create index expenses_created_by_idx on private.expenses(created_by);
create index inventory_transactions_created_by_idx on private.inventory_transactions(created_by);
create index orders_created_by_idx on private.orders(created_by);
create index recommendations_approved_by_idx on private.recommendations(approved_by);
create index recommendations_created_by_idx on private.recommendations(created_by);
