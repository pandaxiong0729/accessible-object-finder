"""Schema and temporal gates, not an object detector or a physical-safety guarantee."""

from fastapi import HTTPException

from .schemas import AnalyzeRequest, ModelObservation

MOVEMENT_ACTIONS = {"move_left", "move_right", "move_away", "move_toward", "grasp"}
ALLOWED_ACTIONS = {
    "search": {"scan", "position", "hold", "uncertain"},
    "calibrate": {"calibrated", "hold", "uncertain"},
    "guide": MOVEMENT_ACTIONS | {"hold", "show_object", "uncertain"},
    "verify": {"show_object", "confirmed", "wrong_object", "hold", "uncertain"},
}
INSTRUCTIONS = {
    "scan": "暂时没有确认目标，请停稳手机后重新拍摄。",
    "position": "已找到候选目标，请将手机放稳在支架上，再进行方向校准。",
    "calibrated": "方向校准完成，请保持手机不动，停手等待下一条提示。",
    "move_left": "手沿桌面向你的左侧缓慢挪一点，然后停住。",
    "move_right": "手沿桌面向你的右侧缓慢挪一点，然后停住。",
    "move_away": "手沿桌面向远离身体的方向缓慢挪一点，然后停住。",
    "move_toward": "手沿桌面向靠近身体的方向缓慢挪一点，然后停住。",
    "hold": "请先停手，等待重新确认画面。",
    "grasp": "请在同伴保护下尝试抓取，感到阻碍时立即停下。",
    "show_object": "请将手中物品缓慢抬离桌面并保持可见，等待核验。",
    "confirmed": "画面显示手中是目标物品；这不代表已经握牢，请自行确认。",
    "wrong_object": "画面显示手中物品与目标不符，请停住并请同伴核对。",
    "uncertain": "暂时无法确认，请先停手，再请同伴帮助核对。",
}


def uncertain(reason: str, *, action="uncertain") -> ModelObservation:
    return ModelObservation(
        action=action, instruction=INSTRUCTIONS[action], reason=reason,
        target_visible=False, hand_visible=False, reference_valid=False,
        grasp_state="unknown", target_matches=None, object_lifted=None,
    )


def validate_request_semantics(request: AnalyzeRequest, now_ms: int) -> None:
    total = len(request.frames) + len(request.calibration_frames) + int(request.reference is not None)
    if total > 6:
        raise HTTPException(400, "每次最多上传 6 张图片（包括参照和校准图片）。")
    if request.mode == "mock":
        return
    expected = {"search": 1, "calibrate": 3, "guide": 1, "verify": 3}[request.phase]
    if len(request.frames) != expected:
        raise HTTPException(400, f"此阶段需要 {expected} 张新的当前图片。")
    frames = request.frames
    if len({frame.id for frame in frames}) != len(frames):
        raise HTTPException(400, "当前图片编号必须各不相同。")
    if len(frames) > 1 and len({frame.data_url for frame in frames}) != len(frames):
        raise HTTPException(400, "请实际采集新的图片序列，不能重复提交同一图片。")
    if any(a.captured_at_ms >= b.captured_at_ms for a, b in zip(frames, frames[1:])):
        raise HTTPException(400, "图片采集时间必须严格递增。")
    if any(frame.captured_at_ms > now_ms + 5000 for frame in frames):
        raise HTTPException(400, "设备时间与服务器不一致，请检查手机时间。")
    max_age = 60_000 if request.phase == "calibrate" else 30_000
    if any(now_ms - frame.captured_at_ms > max_age for frame in frames):
        raise HTTPException(400, "当前画面过旧，请重新拍摄，不能复用历史图片。")
    historical = request.calibration_frames + ([request.reference] if request.reference else [])
    if request.phase in {"guide", "verify"}:
        if any(frame.id in {old.id for old in historical} for frame in frames):
            raise HTTPException(400, "当前图片不能用历史参照或校准图片代替。")
        if historical and frames[0].captured_at_ms <= max(old.captured_at_ms for old in historical):
            raise HTTPException(400, "当前图片必须在参照和校准之后新拍摄。")
    if request.phase == "verify":
        if request.reference is None:
            raise HTTPException(400, "真实抓取核验必须提供目标参照。")
        if frames[-1].captured_at_ms - frames[0].captured_at_ms > 10_000:
            raise HTTPException(400, "核验图片应在 10 秒内连续采集。")


def preflight_gate(request: AnalyzeRequest) -> ModelObservation | None:
    if request.phase == "guide":
        if not request.calibrated:
            return uncertain("尚未完成方向校准，请重新校准后再开始引导。", action="hold")
        if request.mode == "live" and (request.reference is None or len(request.calibration_frames) != 2):
            return uncertain("缺少固定机位原点或两种用户方向的校准图，不能推断身体方向。", action="hold")
    return None


def apply_gates(request: AnalyzeRequest, result: ModelObservation, now_ms: int) -> ModelObservation:
    data = result.model_dump()
    if request.prompt_style == "baseline":
        data.update(
            action="uncertain", instruction="对照结果仅供观察，请不要据此移动手。",
            reason=("对照观察，不用于行动：" + result.instruction + "；" + result.reason)[:500],
            grasp_state="unknown", target_matches=None, object_lifted=None,
        )
    elif result.action not in ALLOWED_ACTIONS[request.phase]:
        data = uncertain("模型返回了不适用于当前阶段的动作，已停止指导。").model_dump()
    elif request.phase == "calibrate" and result.action == "calibrated" and not (
        result.target_visible and result.hand_visible and result.reference_valid
    ):
        data = uncertain("没有足够证据确认校准有效，请重新校准。").model_dump()
    elif request.phase == "search" and result.action == "position" and not result.target_visible:
        data = uncertain("没有确认目标可见，不能进入固定机位步骤。").model_dump()
    elif request.phase == "guide":
        blocked = preflight_gate(request)
        if blocked:
            data = blocked.model_dump()
        elif not (result.target_visible and result.hand_visible and result.reference_valid):
            data = uncertain(
                "手、目标或固定机位参照无法确认，请停手并重新检查。",
                action="uncertain" if result.action == "uncertain" else "hold",
            ).model_dump()
        elif request.mode == "live" and now_ms - request.frames[-1].captured_at_ms > 6000:
            data = uncertain("画面已超过 6 秒，旧指令已作废，请停稳后重新拍摄。", action="hold").model_dump()
    elif request.phase == "verify":
        evidence = (
            result.target_visible and result.hand_visible and result.reference_valid
            and result.target_matches is True and result.object_lifted is True
        )
        fresh = request.mode == "mock" or (
            request.reference is not None and len(request.frames) >= 3
            and now_ms - request.frames[-1].captured_at_ms <= 6000
        )
        if result.action == "confirmed" and not (evidence and fresh):
            data = uncertain("尚缺少新鲜多帧中的目标身份、手持及离桌证据，不能确认抓取。").model_dump()
        elif result.action == "wrong_object" and not (
            result.hand_visible and result.reference_valid and result.target_matches is False and fresh
        ):
            data = uncertain("无法可靠核对手中物品身份，请重新展示。").model_dump()
        elif result.action == "show_object" and not (result.hand_visible and result.reference_valid and fresh):
            data = uncertain("当前手部或参照不可确认，请停住并请同伴检查取景。").model_dump()
    # Strict action wording prevents a model's free text from hiding a second or contradictory command.
    # Recognition/direction is still model-driven; these templates are not a detection algorithm.
    if request.prompt_style != "baseline":
        data["instruction"] = INSTRUCTIONS[data["action"]]
    if data["action"] == "confirmed":
        data["grasp_state"] = "confirmed"
    elif data["action"] == "wrong_object":
        data["grasp_state"] = "wrong"
    elif data["grasp_state"] in {"confirmed", "wrong"}:
        data["grasp_state"] = "unknown"
    if request.mode == "mock":
        data["instruction"] = "模拟演示，不是真实识别。" + data["instruction"]
        data["reason"] = ("模拟数据：" + data["reason"])[:500]
    return ModelObservation.model_validate(data)
