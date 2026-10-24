import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssistant } from './useAssistant';
import type { AnalyzeRequest, Observation } from './lib/contracts';

const fake=vi.hoisted(()=>({analyze:vi.fn(),stopCamera:vi.fn(),stopSpeech:vi.fn(),speak:vi.fn(async()=>{}),health:vi.fn(async()=>({status:'ok',live_available:false,asr_available:false,model:'test',prompt_version:'v1'}))}));
vi.mock('./lib/api',()=>({health:fake.health,analyze:fake.analyze,transcribe:vi.fn()}));
vi.mock('./lib/media',()=>({
  CameraService:class{stop=fake.stopCamera;isActive(){return false;}},
  SpeechService:class{stop=fake.stopSpeech;speak=fake.speak;available(){return false;}},
  RecorderService:class{cancel(){}},
}));
function result(r:AnalyzeRequest):Observation{
  const base:Observation={session_id:r.session_id,request_id:r.request_id,mode:r.mode,phase:r.phase,action:'scan',instruction:'模拟演示：测试指令',reason:'',target_visible:true,hand_visible:true,reference_valid:true,grasp_state:'not_held',target_matches:null,object_lifted:null,latency_ms:1,prompt_version:'v1'};
  if(r.phase==='search')base.action=r.turn===0?'scan':'position';
  if(r.phase==='calibrate')base.action='calibrated';
  if(r.phase==='guide')base.action='grasp';
  if(r.phase==='verify')Object.assign(base,{action:'confirmed',grasp_state:'confirmed',target_matches:true,object_lifted:true});
  return base;
}
beforeEach(()=>{vi.useRealTimers();vi.clearAllMocks();fake.analyze.mockImplementation(async(r:AnalyzeRequest)=>result(r));});
describe('assistant integration with mock APIs',()=>{
  it('runs from search to automatic confirmation after calibration',async()=>{
    const {result:r}=renderHook(()=>useAssistant());
    await act(()=>r.current.start());
    await waitFor(()=>expect(r.current.stage).toBe('position'),{timeout:3500});
    await act(()=>r.current.beginCalibration());
    expect(r.current.stage).toBe('calibration');
    await act(()=>r.current.captureCalibration());await act(()=>r.current.captureCalibration());await act(()=>r.current.captureCalibration());
    await waitFor(()=>expect(r.current.stage).toBe('success'),{timeout:3500});
    expect(r.current.outcome).toBe('未标注');
    expect(r.current.events.some(e=>e.action==='confirmed')).toBe(true);
    expect(r.current.events.every(e=>e.mode==='mock')).toBe(true);
  });
  it('late response cannot restart a reset task',async()=>{
    let resolve!:(o:Observation)=>void;let received!:AnalyzeRequest;
    fake.analyze.mockImplementation((r:AnalyzeRequest)=>{received=r;return new Promise<Observation>(yes=>{resolve=yes;});});
    const {result:r}=renderHook(()=>useAssistant());await act(()=>r.current.start());
    await waitFor(()=>expect(fake.analyze).toHaveBeenCalled(),{timeout:2000});
    act(()=>r.current.reset());await act(async()=>resolve({...result(received),action:'position'}));
    expect(r.current.stage).toBe('idle');expect(r.current.running).toBe(false);expect(r.current.events).toHaveLength(0);
  });
  it('pause immediately stops camera and speech',async()=>{
    const {result:r}=renderHook(()=>useAssistant());await act(()=>r.current.start());act(()=>r.current.pause());
    expect(r.current.running).toBe(false);expect(fake.stopCamera).toHaveBeenCalled();expect(fake.stopSpeech).toHaveBeenCalled();
  });
  it('changing mode clears old evidence and returns to idle',async()=>{
    const {result:r}=renderHook(()=>useAssistant());await act(()=>r.current.start());act(()=>r.current.setMode('live'));
    expect(r.current.stage).toBe('idle');expect(r.current.mode).toBe('live');expect(r.current.running).toBe(false);expect(r.current.consent).toBe(false);
  });
  it('live mode cannot start silently without consent or configuration',async()=>{
    const {result:r}=renderHook(()=>useAssistant());act(()=>r.current.setMode('live'));await act(()=>r.current.start());
    expect(r.current.error).toContain('同意');expect(fake.analyze).not.toHaveBeenCalled();
  });
});
