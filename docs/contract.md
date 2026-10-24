# Demo API contract v1

All browser calls use `/api`; Vite proxies to local FastAPI port 8000. Production frontend can be served by FastAPI from `web/dist`. Real provider requests are only from the backend. HTTPS is required for phone camera use away from localhost.

## GET /api/health
Returns `{status:"ok",live_available:boolean,asr_available:boolean,model:string,prompt_version:string}`. Availability means configured, NOT tested credentials. Default mock mode never requires keys.

## POST /api/analyze (JSON)
Request: `{session_id:string,request_id:string,mode:"mock"|"live",phase:"search"|"calibrate"|"guide"|"verify",target:string,turn:number,prompt_style:"accessible"|"baseline",frames:Frame[],reference:Frame|null,calibration_frames:Frame[],calibrated:boolean,scenario:"success"|"not_found"|"wrong_object"|"occluded",last_instruction:string}`.
Frame: `{id:string,captured_at_ms:number,data_url:string}`. Actual camera frames JPEG/PNG data URLs, max 1 MB decoded each, max 6 frames/request including reference/calibration. Never accept remote image URLs. User target max 120 chars. `scenario` affects mock only. Browser sends 1 current frame for search/guide, 3 calibration sequence frames for calibrate, 3 fresh sequence frames for verify. For guide/verify send 2 calibration frames (right + away), plus reference, for max total 6. Reference is allowed old (identity only), current frames are never historical substitutes.

Response: `{session_id,request_id,mode,phase,action,instruction,reason,target_visible,hand_visible,reference_valid,grasp_state,target_matches,object_lifted,latency_ms,prompt_version}`.
action enum: `scan|position|calibrated|move_left|move_right|move_away|move_toward|hold|grasp|show_object|confirmed|wrong_object|uncertain`.
grasp_state enum: `not_held|candidate|confirmed|wrong|unknown`.
target_matches/object_lifted: boolean or null. Other visibility/reference booleans.
The backend, not model, fills ids/mode/phase/latency/prompt_version. Model output must be strictly validated.

Safety gates: guide requires client calibration + reference + current frames in live mode; no visible hand/target/reference = hold/uncertain, not a movement. `confirmed` only in verify, with >=3 fresh ordered frames in live mode, target_matches=true and object_lifted=true. Require reference for live verification. No fallback from live error to mock success. Baseline prompt comparison is for observation only, never live physical instructions. Mock output includes an audible simulation prefix.

Mock: search first turn scan then position; calibrate→calibrated; guide turn0 move_right, turn1 move_away, turn2 grasp; verify turn0 show_object, turn1 confirmed. Scenario not_found stays scan; occluded guidance/verification uncertain; wrong_object verify wrong_object. Respect calibration gate in mock too. Empty frames allowed ONLY mock.

Errors: standard HTTP status with `{detail:string}` (400 invalid body semantics, 422 schema, 401/403 access if configured, 429 request cap, 502 provider/invalid model output, 503 unavailable configuration, 504 upstream timeout). Never expose provider secret/response raw contents.

## POST /api/transcribe (JSON)
`{audio_data_url:string}` → `{text:string}`. Limit encoded request, decode only allowed MIME base64 (wav/webm/ogg/mp4/mpeg), no external URL. Live server ASR only; 503 if unconfigured, no fake transcription. Browser recording max 10 seconds; user confirms/edit result before search. Browser speech recognition may be offered as alternative but no silent external transmission.

## State/client
Stages idle/search/position/calibration/guide/verify/success. Pause/error separate from stage; user re-enters calibration after live guidance pause or page hide. Controls can stop media, speech and pending fetch. A response cannot affect another session, request or calibration version. Live directional results >6s after capture are rejected; only one request in flight. No persisted images/audio. Session event export is explicit and labeled mock/live; true outcomes are user-entered, separate from model decision.
