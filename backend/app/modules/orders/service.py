from app.modules.common import operational_response


class OrderService:
    def __init__(self, gateway, role):
        self.gateway, self.role = gateway, role

    async def read(self, params):
        return operational_response(await self.gateway.read("orders", params), self.role)

    async def execute(self, operation, data, key):
        return operational_response(await self.gateway.command(operation, data, key), self.role)
