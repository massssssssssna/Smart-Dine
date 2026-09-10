from app.modules.common import operational_response


class MenuService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, params, role):
        return operational_response(await self.gateway.read("menu", params), role)

    async def save(self, operation, data, key):
        return await self.gateway.command(operation, data, key)
