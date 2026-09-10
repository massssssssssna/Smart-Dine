class ExpenseService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, params):
        return await self.gateway.read("expenses", params)

    async def create(self, data, key):
        return await self.gateway.command("expense_create", data, key)

    async def void(self, data, key):
        return await self.gateway.command("expense_void", data, key)
