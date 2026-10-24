from .safety import INSTRUCTIONS, uncertain
from .schemas import AnalyzeRequest, ModelObservation


def simulate(request: AnalyzeRequest) -> ModelObservation:
    """Deterministic UI fixtures only: no image analysis and no claim of accuracy."""
    if request.scenario == "not_found":
        return uncertain("预设未找到目标场景。", action="scan" if request.phase == "search" else "uncertain")
    if request.scenario == "occluded":
        return uncertain("预设遮挡场景，无法确认手与目标。")
    action = "uncertain"
    state = "not_held"
    matches = None
    lifted = False
    if request.phase == "search":
        action = "scan" if request.turn == 0 else "position"
    elif request.phase == "calibrate":
        action = "calibrated"
    elif request.phase == "guide":
        action = ["move_right", "move_away", "grasp"][min(request.turn, 2)]
    elif request.phase == "verify":
        if request.scenario == "wrong_object":
            action, state, matches, lifted = "wrong_object", "wrong", False, True
        elif request.turn == 0:
            action, state = "show_object", "candidate"
        else:
            action, state, matches, lifted = "confirmed", "confirmed", True, True
    return ModelObservation(
        action=action, instruction=INSTRUCTIONS[action], reason="按预设脚本生成，未调用摄像头识别。",
        target_visible=action != "scan", hand_visible=True, reference_valid=True,
        grasp_state=state, target_matches=matches, object_lifted=lifted,
    )
