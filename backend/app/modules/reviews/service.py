from app.modules.common import payload


class ReviewService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, params):
        return await self.gateway.read("reviews", params)

    async def issue_token(self, data, key):
        return await self.gateway.command("review_token_create", data, key)

    async def submit(self, body):
        data = payload(body)
        data["token"] = body.token.get_secret_value()
        result = await self.gateway.service("review_submit", data)
        # A public receipt contains neither order data nor the feedback bearer token.
        return {"id": result["id"], "status": "received"}
