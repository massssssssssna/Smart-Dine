import time
from collections import defaultdict, deque
from uuid import uuid4

from starlette.responses import JSONResponse


class RequestGuards:
    """Bound request bodies and per-process public endpoint traffic.

    Use one API worker in this local deployment. A multi-instance deployment
    must move rate limits to a trusted shared ingress before scaling.
    """

    def __init__(self, app, max_body_bytes: int = 2 * 1024 * 1024):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.events: dict[tuple[str, str], deque] = defaultdict(deque)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        path = scope["path"]
        method = scope["method"]
        limits = {"/api/v1/auth/login": 10, "/api/v1/auth/refresh": 30,
                  "/api/v1/reviews/submit": 10, "/api/v1/assistant/questions": 10}
        now = time.monotonic()

        async def reject(code, message, status):
            response = JSONResponse({"code": code, "message": message, "request_id": request_id},
                                    status_code=status, headers={"X-Request-ID": request_id})
            if status == 429:
                response.headers["Retry-After"] = "60"
            await response(scope, receive, send)

        if method == "POST" and path in limits:
            if len(self.events) >= 10000:
                self.events = defaultdict(deque, {k: v for k, v in self.events.items() if v and v[-1] > now - 60})
                if len(self.events) >= 10000:
                    return await reject("rate_limited", "Please retry shortly.", 429)
            client = scope.get("client") or ("unknown", 0)
            events = self.events[(client[0], path)]
            while events and events[0] <= now - 60:
                events.popleft()
            if len(events) >= limits[path]:
                return await reject("rate_limited", "Too many requests. Retry after one minute.", 429)
            events.append(now)
        # Buffer a bounded body before dispatch, including chunked uploads.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.max_body_bytes:
                return await reject("request_too_large", "Request exceeds the 2 MB limit.", 413)
            chunks.append(message)
            if not message.get("more_body", False):
                break
        index = 0
