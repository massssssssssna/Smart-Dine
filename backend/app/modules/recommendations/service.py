class RecommendationService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, params):
        return await self.gateway.read("recommendations", params)

    async def execute(self, operation, data, key):
        return await self.gateway.command(operation, data, key)
