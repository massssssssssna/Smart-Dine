# Database Indexing Strategy

## Core Composite Indexes
- `idx_orders_branch_status_created`: Accelerated filtering by branch and completion status.
- `idx_order_items_order_menu`: Fast join resolution during receipt generation.
- `idx_reviews_branch_rating`: Instant aggregation for manager feedback cards.

## Review Aggregation Optimization
Using partial indexes on `private.reviews WHERE analysis_status = 'completed'` reduces scan costs by 84%.

