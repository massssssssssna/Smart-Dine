class AnalyticsService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def report(self, report, dates):
        result = await self.gateway.read("analytics", {"report": report, **dates})
        return {"period": dates, "timezone": "Asia/Karachi", "currency": "PKR", "data": result}
