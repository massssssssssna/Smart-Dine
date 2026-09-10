class AuditService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, params):
        return await self.gateway.read("audit", params)
