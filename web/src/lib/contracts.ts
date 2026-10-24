export type Mode = 'mock' | 'live';
export type Phase = 'search' | 'calibrate' | 'guide' | 'verify';
export type Stage = 'idle' | 'search' | 'position' | 'calibration' | 'guide' | 'verify' | 'success';
export type Scenario = 'success' | 'not_found' | 'wrong_object' | 'occluded';
export type Action = 'scan' | 'position' | 'calibrated' | 'move_left' | 'move_right' | 'move_away' | 'move_toward' | 'hold' | 'grasp' | 'show_object' | 'confirmed' | 'wrong_object' | 'uncertain';
export interface Frame { id: string; captured_at_ms: number; data_url: string }
export interface AnalyzeRequest {
  session_id: string; request_id: string; mode: Mode; phase: Phase; target: string;
  turn: number; prompt_style: 'accessible' | 'baseline'; frames: Frame[]; reference: Frame | null;
  calibration_frames: Frame[]; calibrated: boolean; scenario: Scenario; last_instruction: string;
}
export interface Observation {
  session_id: string; request_id: string; mode: Mode; phase: Phase; action: Action;
  instruction: string; reason: string; target_visible: boolean; hand_visible: boolean;
  reference_valid: boolean; grasp_state: 'not_held' | 'candidate' | 'confirmed' | 'wrong' | 'unknown';
  target_matches: boolean | null; object_lifted: boolean | null; latency_ms: number; prompt_version: string;
}
export interface Health { status: string; live_available: boolean; asr_available: boolean; model: string; prompt_version: string }
