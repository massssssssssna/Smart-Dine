from app.modules.common import operational_response


class InventoryService:
    def __init__(self, gateway, role):
        self.gateway, self.role = gateway, role

    async def read(self, resource, params):
        return operational_response(await self.gateway.read(resource, params), self.role)

    async def alerts(self):
        rows = await self.gateway.query(
            """
            SELECT i.id, coalesce(live_menu.name, i.name) AS name,
                   i.stock_quantity, i.reorder_level, i.unit
            FROM private.ingredients i
            JOIN private.profiles p ON p.id = auth.uid() AND p.branch_id = i.branch_id
            LEFT JOIN LATERAL (
              SELECT m.name FROM private.menu_items m
              WHERE m.stock_ingredient_id = i.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC LIMIT 1
            ) live_menu ON true
            WHERE i.is_active
              AND i.stock_quantity <= i.reorder_level
              AND (
                live_menu.name IS NOT NULL
                OR NOT EXISTS (
                  SELECT 1 FROM private.menu_items historical
                  WHERE historical.stock_ingredient_id = i.id
                )
              )
            ORDER BY (i.stock_quantity = 0) DESC, i.stock_quantity, i.name
            """
        )
        return {"items": rows, "total": len(rows)}

    async def execute(self, operation, data, key):
        return operational_response(await self.gateway.command(operation, data, key), self.role)
