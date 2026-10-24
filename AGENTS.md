# 寻物助手课程 Demo

## Product scope
- Phone-first web app: spoken target → scan → put phone on stand → calibrate user directions → stepwise hand guidance → automatic visual grasp verification.
- Use an existing VLM API. Prompt engineering improves non-visual, actionable expression. Do not invent a separate detection/tracking model or start fine-tuning by default.
- Mock mode is explicitly simulated, never a claim of recognition. Live mode requires server credentials and consent before uploading camera images.
- Only controlled tabletop testing with safe objects. Image overlap or disappearance alone is not evidence of grasp success.
- Retain `deliverables/` and existing user files. No secrets, recordings or camera frames in logs or source control.

## Implementation
- Frontend: React, TypeScript, Vite. Backend: FastAPI, httpx, Pydantic.
- API contract: `docs/contract.md`. Frontend types: `web/src/lib/contracts.ts`.
- Read contract before editing; coordinate contract changes with the main agent.
- Use apply_patch for source/document edits. Do not run git reset, clean or overwrite unrelated changes.
- Test mock and rejected/error paths. Never claim live model or blind-user validation without actual evidence.
