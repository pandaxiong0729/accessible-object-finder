from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .media import validate_audio, validate_image

Mode = Literal["mock", "live"]
Phase = Literal["search", "calibrate", "guide", "verify"]
Action = Literal[
    "scan", "position", "calibrated", "move_left", "move_right", "move_away", "move_toward",
    "hold", "grasp", "show_object", "confirmed", "wrong_object", "uncertain",
]
GraspState = Literal["not_held", "candidate", "confirmed", "wrong", "unknown"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)


class Frame(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    captured_at_ms: int = Field(ge=0)
    data_url: str = Field(max_length=1_398_205)

    @field_validator("data_url")
    @classmethod
    def check_image(cls, value: str) -> str:
        return validate_image(value)


class AnalyzeRequest(StrictModel):
    session_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    mode: Mode
    phase: Phase
    target: str = Field(min_length=1, max_length=120)
    turn: int = Field(ge=0, le=100_000)
    prompt_style: Literal["accessible", "baseline"]
    frames: list[Frame] = Field(max_length=6)
    reference: Frame | None
    calibration_frames: list[Frame] = Field(max_length=3)
    calibrated: bool
    scenario: Literal["success", "not_found", "wrong_object", "occluded"]
    last_instruction: str = Field(max_length=300)

    @field_validator("target")
    @classmethod
    def nonblank_target(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("目标不能为空")
        return value.strip()


class ModelObservation(StrictModel):
    action: Action
    instruction: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=500)
    target_visible: bool
    hand_visible: bool
    reference_valid: bool
    grasp_state: GraspState
    target_matches: bool | None
    object_lifted: bool | None


class AnalyzeResponse(ModelObservation):
    session_id: str
    request_id: str
    mode: Mode
    phase: Phase
    latency_ms: int = Field(ge=0)
    prompt_version: str


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"
    live_available: bool
    asr_available: bool
    model: str
    prompt_version: str


class TranscribeRequest(StrictModel):
    audio_data_url: str = Field(min_length=1, max_length=4_194_404)

    @field_validator("audio_data_url")
    @classmethod
    def check_audio(cls, value: str) -> str:
        return validate_audio(value)


class TranscribeResponse(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
