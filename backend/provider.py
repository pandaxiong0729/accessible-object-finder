"""Small server-side chat/completions adapter; media and provider errors are never logged."""

import json

import httpx
from pydantic import ValidationError

from .config import Settings
from .prompts import build_messages
from .schemas import AnalyzeRequest, ModelObservation


class ProviderError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def strict_json(text: str):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("non-JSON constant")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)


class ModelProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def _complete(self, body: dict) -> str:
        try:
            async with self.client.stream(
                "POST", self.settings.base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": "Bearer " + self.settings.api_key}, json=body,
            ) as response:
                if response.status_code >= 400:
                    raise ProviderError(502, "模型服务拒绝请求，请管理员检查模型、地区与凭据配置。")
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > 65_536:
                        raise ProviderError(502, "模型响应超出允许大小。")
            envelope = strict_json(chunks.decode("utf-8"))
            content = envelope["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip() or len(content) > 16_384:
                raise ValueError("invalid content")
            return content.strip()
        except httpx.TimeoutException:
            raise ProviderError(504, "模型请求超时，请保持手不动，稍后重新拍摄。") from None
        except httpx.HTTPError:
            raise ProviderError(502, "无法连接模型服务，请稍后重试。") from None
        except (KeyError, IndexError, TypeError, ValueError, UnicodeError):
            raise ProviderError(502, "模型响应格式无效，未生成行动指令。") from None

    async def analyze(self, request: AnalyzeRequest) -> ModelObservation:
        payload = {
            "model": self.settings.model,
            "messages": build_messages(request),
            "stream": False,
            "temperature": 0.1,
            "max_tokens": 700,
            "response_format": {"type": "json_object"},
        }
        if self.settings.model.startswith("qwen3-vl"):
            # Documented Qwen-VL parameter: JSON mode is intended for non-thinking output.
            payload["enable_thinking"] = False
        content = await self._complete(payload)
        try:
            return ModelObservation.model_validate(strict_json(content), strict=True)
        except (ValueError, TypeError, ValidationError):
            raise ProviderError(502, "模型输出未通过严格校验，请停手后重新尝试。") from None

    async def transcribe(self, audio_data_url: str) -> str:
        # Qwen-ASR's documented OpenAI-compatible input_audio.data protocol.
        text = await self._complete({
            "model": self.settings.asr_model,
            "messages": [{"role": "user", "content": [{
                "type": "input_audio", "input_audio": {"data": audio_data_url},
            }]}],
            "stream": False,
            "asr_options": {"enable_itn": False},
        })
        if len(text) > 2000:
            raise ProviderError(502, "语音识别结果过长，请录制简短的物品名称。")
        return text
