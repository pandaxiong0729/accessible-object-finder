from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    api_key: str = ""
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "qwen3-vl-flash"
    asr_model: str = "qwen3-asr-flash"
    access_token: str = ""
    timeout_seconds: float = 25.0
    rate_limit_per_minute: int = 30
    max_body_bytes: int = 9 * 1024 * 1024
    allowed_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    web_dist: Path = ROOT / "web" / "dist"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(ROOT / ".env", override=False)
        return cls(
            api_key=os.getenv("MODEL_API_KEY", "").strip(),
            base_url=os.getenv("MODEL_BASE_URL", cls.base_url).strip().rstrip("/"),
            model=os.getenv("MODEL_NAME", cls.model).strip(),
            asr_model=os.getenv("ASR_MODEL", cls.asr_model).strip(),
            access_token=os.getenv("APP_ACCESS_TOKEN", "").strip(),
            timeout_seconds=float(os.getenv("MODEL_TIMEOUT_SECONDS", "25")),
            rate_limit_per_minute=int(os.getenv("RATE_LIMIT_PER_MINUTE", "30")),
            allowed_origins=tuple(
                origin.strip() for origin in os.getenv(
                    "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
                ).split(",") if origin.strip()
            ),
        )

    def validate(self) -> None:
        url = urlsplit(self.base_url)
        local = url.hostname in {"localhost", "127.0.0.1", "::1"}
        if not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("MODEL_BASE_URL 必须是无用户信息、查询或片段的接口地址")
        if url.scheme != "https" and not (url.scheme == "http" and local):
            raise ValueError("模型接口必须使用 HTTPS，本机调试地址除外")
        if not 1 <= self.timeout_seconds <= 120 or self.rate_limit_per_minute < 1:
            raise ValueError("超时或限流配置无效")

    @property
    def live_available(self) -> bool:
        return bool(self.api_key and self.model)

    @property
    def asr_available(self) -> bool:
        return bool(self.api_key and self.asr_model)
