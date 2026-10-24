import { describe, it, expect } from 'vitest';
import type { AnalyzeRequest, Observation } from './contracts';
import { nextStage, reportCsv, validateObservation } from './workflow';

const request: AnalyzeRequest = {session_id:'session',request_id:'req',mode:'mock',phase:'guide',target:'钥匙',turn:0,prompt_style:'accessible',frames:[],reference:null,calibration_frames:[],calibrated:true,scenario:'success',last_instruction:''};
const observation: Observation = {session_id:'session',request_id:'req',mode:'mock',phase:'guide',action:'move_right',instruction:'模拟演示：手向右移动一点，然后停住。',reason:'',target_visible:true,hand_visible:true,reference_valid:true,grasp_state:'not_held',target_matches:null,object_lifted:null,latency_ms:2,prompt_version:'accessible-v1'};
describe('workflow safety',()=>{
  it('accepts matching observations',()=>expect(validateObservation(request,observation)).toBeNull());
  it.each(['session_id','request_id','mode','phase'] as const)('ignores mismatched %s',field=>expect(validateObservation(request,{...observation,[field]:'different'})).not.toBeNull());
  it('rejects stale camera frames',()=>expect(validateObservation({...request,mode:'live',frames:[{id:'f',captured_at_ms:1000,data_url:'x'}]},{...observation,mode:'live'},8000)).not.toBeNull());
  it.each(['reference_valid','hand_visible','target_visible'] as const)('rejects action without %s',field=>expect(validateObservation(request,{...observation,[field]:false})).not.toBeNull());
  it('requires calibration',()=>expect(validateObservation({...request,calibrated:false},observation)).not.toBeNull());
  it('does not allow confirmation in guidance',()=>expect(validateObservation(request,{...observation,action:'confirmed',grasp_state:'confirmed',target_matches:true,object_lifted:true})).not.toBeNull());
  it('requires matching target and lifted object',()=>expect(validateObservation({...request,phase:'verify'},{...observation,phase:'verify',action:'confirmed',grasp_state:'confirmed',target_matches:false,object_lifted:true})).not.toBeNull());
  it('allows evidence-backed mock confirmation only in verify',()=>expect(nextStage('verify',{...observation,phase:'verify',action:'confirmed',grasp_state:'confirmed',target_matches:true,object_lifted:true})).toBe('success'));
  it('does not complete merely because model sees object',()=>expect(nextStage('guide',{...observation,action:'position'})).toBe('guide'));
  it('keeps wrong object in verify',()=>expect(nextStage('verify',{...observation,action:'wrong_object',grasp_state:'wrong'})).toBe('verify'));
  it('escapes CSV cells and marks human labels separately',()=>{const text=reportCsv([{at:'x',mode:'mock',phase:'search',instruction:'=1+1',action:'scan',latency_ms:0,prompt_version:'v1',kind:'model'}],'未标注');expect(text).toContain('"\'=1+1"');expect(text).toContain('human_outcome');expect(text).toContain('未标注');});
});
