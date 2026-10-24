import type { AnalyzeRequest, Observation, Stage } from './contracts';

export function validateObservation(request: AnalyzeRequest, observation: Observation, now = Date.now()): string | null {
  if (request.request_id !== observation.request_id || request.session_id !== observation.session_id || request.phase !== observation.phase || request.mode !== observation.mode) return '回答不属于当前任务，已忽略。';
  if (request.mode === 'live' && request.frames.length && now - request.frames.at(-1)!.captured_at_ms > 6000) return '画面已过期。请保持手机和手不动，重新观察。';
  const movement = ['move_left','move_right','move_away','move_toward','grasp'].includes(observation.action);
  if (movement && (request.phase !== 'guide' || !request.calibrated || !observation.reference_valid || !observation.target_visible || !observation.hand_visible)) return '暂时无法确认手与目标的位置，已停止动作指导。';
  if (observation.action === 'confirmed' && (request.phase !== 'verify' || observation.grasp_state !== 'confirmed' || observation.target_matches !== true || observation.object_lifted !== true || (request.mode === 'live' && request.frames.length < 3))) return '抓取证据不足，不能确认完成。';
  return null;
}

export function nextStage(current: Stage, observation: Observation): Stage {
  if (current === 'search' && observation.action === 'position' && observation.target_visible) return 'position';
  if (current === 'calibration' && observation.action === 'calibrated' && observation.reference_valid) return 'guide';
  if (current === 'guide' && ['grasp','show_object'].includes(observation.action)) return 'verify';
  if (current === 'verify' && observation.action === 'confirmed' && observation.grasp_state === 'confirmed' && observation.target_matches === true && observation.object_lifted === true) return 'success';
  return current;
}

export interface TaskEvent { at: string; mode: string; phase: string; instruction: string; action: string; latency_ms: number; prompt_version: string; kind: 'model' | 'system' | 'comparison' }
export function reportCsv(events: TaskEvent[], outcome: string): string {
  // Prevent spreadsheet formula execution from model/user-controlled cells.
  const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"','""')}"`; };
  const header = ['at','mode','phase','instruction','action','latency_ms','prompt_version','kind','human_outcome'];
  return '\ufeff' + [header,...events.map(e=>[e.at,e.mode,e.phase,e.instruction,e.action,e.latency_ms,e.prompt_version,e.kind,outcome])].map(row=>row.map(cell).join(',')).join('\r\n');
}
