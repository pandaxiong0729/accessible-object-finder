from collections import deque
import hmac
import time

from starlette.responses import JSONResponse

from .config import Settings


class RequestProtectionMiddleware:
    """In-process classroom limits; deliberately ignores untrusted X-Forwarded-For."""

    def __init__(self, app, settings: Settings):
        self.app = app
        self.settings = settings
        self.requests: dict[str, deque[float]] = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def reject(status: int, detail: str):
            response = JSONResponse({"detail": detail}, status_code=status, headers={"Cache-Control": "no-store"})
            await response(scope, receive, send)

        if scope["method"] == "OPTIONS" or scope["path"] == "/api/health":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        token = self.settings.access_token.encode("utf-8")
        if token and not hmac.compare_digest(headers.get(b"x-app-access-token", b""), token):
            await reject(401, "访问口令缺失或无效。")
            return
        if scope["method"] == "POST":
            client = scope.get("client")
            ip = client[0] if client else "unknown"
            now = time.monotonic()
            if len(self.requests) > 1024:
                self.requests = {key: queue for key, queue in self.requests.items() if queue and now - queue[-1] < 60}
            if len(self.requests) > 8192 and ip not in self.requests:
                await reject(429, "请求过多，请稍后重试。")
                return
            queue = self.requests.setdefault(ip, deque())
            while queue and now - queue[0] >= 60:
                queue.popleft()
            if len(queue) >= self.settings.rate_limit_per_minute:
                await reject(429, "请求过于频繁，请一分钟后再试。")
                return
            queue.append(now)
            if b"content-length" in headers:
                try:
                    length = int(headers[b"content-length"])
                except ValueError:
                    await reject(400, "Content-Length 无效。")
                    return
                if length < 0:
                    await reject(400, "Content-Length 无效。")
                    return
                if length > self.settings.max_body_bytes:
                    await reject(413, "请求体过大，请压缩图片或缩短录音。")
                    return
            body = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body.extend(message.get("body", b""))
                if len(body) > self.settings.max_body_bytes:
                    await reject(413, "请求体过大，请压缩图片或缩短录音。")
                    return
                if not message.get("more_body", False):
                    break
            delivered = False

            async def replay_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            await self.app(scope, replay_receive, send)
            return
        await self.app(scope, receive, send)
