import asyncio
from contextlib import asynccontextmanager
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

from .config import Settings
from .middleware import RequestProtectionMiddleware
from .mock import simulate
from .prompts import PROMPT_VERSION
from .provider import ModelProvider, ProviderError
from .safety import apply_gates, preflight_gate, validate_request_semantics
from .schemas import AnalyzeRequest, AnalyzeResponse, HealthResponse, TranscribeRequest, TranscribeResponse


def create_app(settings: Settings | None = None, *, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(settings.timeout_seconds), transport=transport,
            follow_redirects=False, trust_env=False,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        ) as client:
            app.state.provider = ModelProvider(settings, client)
            app.state.provider_slots = asyncio.Semaphore(2)
            yield

    app = FastAPI(title="桌面寻物课程 Demo", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(RequestProtectionMiddleware, settings=settings)
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=list(settings.allowed_origins),
            allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "X-App-Access-Token"],
        )

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _error: RequestValidationError):
        # FastAPI's default error includes the input; never echo a base64 image/audio or arbitrary target.
        return JSONResponse({"detail": "请求格式无效，请检查必填字段、媒体格式和大小。"}, status_code=422)

    @app.exception_handler(ProviderError)
    async def provider_error(_request: Request, error: ProviderError):
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)

    async def invoke_provider(operation):
        try:
            await asyncio.wait_for(app.state.provider_slots.acquire(), timeout=0.1)
        except TimeoutError:
            raise HTTPException(429, "模型服务忙，请保持手不动，稍后重新拍摄。") from None
        try:
            return await asyncio.wait_for(operation(), timeout=settings.timeout_seconds)
        except TimeoutError:
            raise ProviderError(504, "模型请求超时，请保持手不动，稍后重新拍摄。") from None
        finally:
            app.state.provider_slots.release()

    @app.get("/api/health", response_model=HealthResponse)
    async def health():
        # Public configuration status only; this does not make an upstream call or verify credentials.
        return HealthResponse(
            live_available=settings.live_available, asr_available=settings.asr_available,
            model=settings.model, prompt_version=PROMPT_VERSION,
        )

    @app.post("/api/analyze", response_model=AnalyzeResponse)
    async def analyze(body: AnalyzeRequest):
        started = time.monotonic()
        if body.mode == "live" and not settings.live_available:
            raise HTTPException(503, "真实模型尚未配置，不能进行真实识别；可主动切换模拟演示。")
        validate_request_semantics(body, int(time.time() * 1000))
        result = preflight_gate(body)
        if result is None:
            if body.mode == "mock":
                result = simulate(body)
            else:
                result = await invoke_provider(lambda: app.state.provider.analyze(body))
        result = apply_gates(body, result, int(time.time() * 1000))
        return AnalyzeResponse(
            **result.model_dump(), session_id=body.session_id, request_id=body.request_id,
            mode=body.mode, phase=body.phase, latency_ms=int((time.monotonic() - started) * 1000),
            prompt_version=PROMPT_VERSION + "/" + body.prompt_style,
        )

    @app.post("/api/transcribe", response_model=TranscribeResponse)
    async def transcribe(body: TranscribeRequest):
        if not settings.asr_available:
            raise HTTPException(503, "服务端语音识别尚未配置，请手动输入目标。")
        text = await invoke_provider(lambda: app.state.provider.transcribe(body.audio_data_url))
        return TranscribeResponse(text=text)

    # Only built frontend assets are served; source, .env and uploads are never in a static directory.
    assets = settings.web_dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/", include_in_schema=False)
    async def frontend():
        index = settings.web_dist / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse({"detail": "前端尚未构建；开发时使用 Vite 页面，或先构建 web/dist。"}, status_code=404)

    return app


app = create_app()
