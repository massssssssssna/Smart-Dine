class AuditService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def _resolve_profiles(self):
        try:
            users_res = await self.gateway.read("users", {"limit": 200, "offset": 0})
            if isinstance(users_res, dict) and "items" in users_res:
                return {str(u["id"]): u for u in users_res["items"] if "id" in u}
        except Exception:
            pass
        return {}

    async def read(self, params):
        data = await self.gateway.read("audit", params)
        if not data:
            return data
        user_map = await self._resolve_profiles()

        def _enrich(item):
            if isinstance(item, dict):
                actor_id = str(item.get("actor_id") or "")
                user = user_map.get(actor_id)
                if user:
                    item["actor_name"] = user.get("full_name") or user.get("email")
                    item["actor_role"] = user.get("role")
                elif not item.get("actor_name"):
                    item["actor_name"] = "System / AI Engine"
                    item["actor_role"] = "system"

        if isinstance(data, dict):
            if "items" in data and isinstance(data["items"], list):
                for it in data["items"]:
                    _enrich(it)
            else:
                _enrich(data)
        elif isinstance(data, list):
            for it in data:
                _enrich(it)

        return data
