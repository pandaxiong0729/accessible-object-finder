"""Validate uploaded media in memory. Never resolve remote URLs or save media."""

import base64
import binascii
from io import BytesIO
import re
import warnings
import wave

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 1024 * 1024
MAX_AUDIO_BYTES = 3 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_IMAGE_DIMENSION = 4096
DATA_URL = re.compile(
    r"^data:([a-zA-Z0-9/+.-]+)(?:;codecs=[\w.,\-\"]+)?;base64,([A-Za-z0-9+/]*={0,2})$"
)


def decode_data_url(value: str, allowed: set[str], limit: int) -> tuple[str, bytes]:
    if len(value) > (limit + 2) // 3 * 4 + 100:
        raise ValueError("媒体文件过大")
    match = DATA_URL.fullmatch(value)
    if not match or match.group(1).lower() not in allowed:
        raise ValueError("仅接受允许类型的 base64 Data URL，不接受外部地址")
    try:
        decoded = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("媒体 base64 编码无效") from None
    if not decoded or len(decoded) > limit:
        raise ValueError("媒体为空或超过大小限制")
    return match.group(1).lower(), decoded


def validate_image(value: str) -> str:
    mime, decoded = decode_data_url(value, {"image/jpeg", "image/png"}, MAX_IMAGE_BYTES)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(decoded)) as image:
                expected = "JPEG" if mime == "image/jpeg" else "PNG"
                if image.format != expected or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("图片格式与声明不符或包含多帧")
                if max(image.size) > MAX_IMAGE_DIMENSION or image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("图片分辨率过大，请先压缩")
                image.verify()
            # verify() alone does not fully decode JPEG data; enforce decodability too.
            with Image.open(BytesIO(decoded)) as image:
                image.load()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise ValueError("图片损坏或不受支持") from None
    return value


def validate_audio(value: str) -> str:
    mime, decoded = decode_data_url(
        value, {"audio/wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"}, MAX_AUDIO_BYTES
    )
    signatures = {
        "audio/wav": decoded[:4] == b"RIFF" and decoded[8:12] == b"WAVE",
        "audio/webm": decoded[:4] == b"\x1a\x45\xdf\xa3",
        "audio/ogg": decoded[:4] == b"OggS",
        "audio/mp4": decoded[4:8] == b"ftyp",
        "audio/mpeg": decoded[:3] == b"ID3" or (len(decoded) > 2 and decoded[0] == 255 and decoded[1] & 224 == 224),
    }
    if len(decoded) < 12 or not signatures[mime]:
        raise ValueError("音频格式与文件头不符")
    if mime == "audio/wav":
        try:
            with wave.open(BytesIO(decoded), "rb") as recording:
                if recording.getnframes() / recording.getframerate() > 10.5:
                    raise ValueError("录音请限制在 10 秒内")
        except (wave.Error, EOFError, ZeroDivisionError):
            raise ValueError("WAV 音频无效") from None
    # Browser MediaRecorder can add codecs=opus; the provider receives a canonical MIME URI.
    return f"data:{mime};base64,{base64.b64encode(decoded).decode('ascii')}"
