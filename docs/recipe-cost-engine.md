# Recipe Cost Engine

## Recipe Modeling
- Dishes link to raw ingredients through `private.recipes`.
- Yield factors account for cooking shrink (e.g. 15% moisture loss on poultry roasting).
- Estimated ingredient cost computed automatically upon dish order.

## Packaging Overhead
Takeaway containers, wrapping bags, and napkins tracked per item as explicit packaging cost.

## Decoupled Updates
Menu item selling price changes do not mutate historical ingredient cost snapshots stored in `private.order_items`.
