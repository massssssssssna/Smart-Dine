class TablesService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, resource, params):
        return await self.gateway.read(resource, params)

    async def save(self, operation, data, key):
        return await self.gateway.command(operation, data, key)
