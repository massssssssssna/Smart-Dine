class RecipeService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def get(self, item_id):
        return await self.gateway.read("recipes", {"id": str(item_id)})

    async def replace(self, data, key):
        return await self.gateway.command("recipe_set", data, key)
