import { useEffect, useRef, useState } from 'react';
import type { AnalyzeRequest, Frame, Health, Mode, Observation, Scenario, Stage } from './lib/contracts';
import { analyze, health, transcribe } from './lib/api';
import { CameraService, RecorderService, SpeechService } from './lib/media';
import { nextStage, reportCsv, validateObservation, type TaskEvent } from './lib/workflow';

const uid = () => crypto.randomUUID();
const aborted = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const message = (error: unknown) => error instanceof Error ? error.message : '暂时无法处理，请重试。';
export function useAssistant() {
  const [mode, setModeState] = useState<Mode>('mock');
  const [scenario, setScenario] = useState<Scenario>('success');
  const [target, setTarget] = useState('钥匙');
  const [stage, setStageState] = useState<Stage>('idle');
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState('');
  const [service, setService] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('告诉我，你想找什么？');
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [outcome, setOutcome] = useState('未标注');
  const [comparison, setComparison] = useState<{ baseline: string; accessible: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useRef(new CameraService());
  const speech = useRef(new SpeechService());
  const recorder = useRef(new RecorderService());
  const epoch = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const session = useRef(uid());
  const reference = useRef<Frame | null>(null);
  const calibration = useRef<Frame[]>([]);
  const calibrated = useRef(false);
  const turns = useRef({ search: 0, calibrate: 0, guide: 0, verify: 0 });
  const stageRef = useRef<Stage>('idle');
  const busyRef = useRef(false);
  const startedAt = useRef(0);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<() => Promise<void>>(async () => {});
  const finishRecordingRef = useRef<() => Promise<void>>(async () => {});
  const setStage = (value: Stage) => { stageRef.current = value; setStageState(value); };
  const lock = (value: boolean) => { busyRef.current = value; setBusy(value); };
  const addEvent = (event: TaskEvent) => setEvents(items => [...items, event].slice(-200));
  const system = (text: string) => addEvent({at:new Date().toISOString(),mode,phase:stageRef.current,instruction:text,action:'hold',latency_ms:0,prompt_version:'',kind:'system'});
  async function say(text: string, stamp = epoch.current) {
    setInstruction(text);
    if (stamp !== epoch.current) return;
    try { await speech.current.speak(text); } catch { /* instruction remains visible / readable */ }
  }
  function cancel() {
    epoch.current += 1;
    requestAbort.current?.abort();
    requestAbort.current = null;
    speech.current.stop();
    recorder.current.cancel();
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    setRecording(false);
    setRunning(false);
    lock(false);
  }
  function pause(reason = '已暂停。手机和手的位置变化后，请重新固定并校准。') {
    cancel(); camera.current.stop(); setCameraReady(false);
    calibrated.current = false; calibration.current = []; setCalibrationStep(0);
    if (['guide','verify','calibration'].includes(stageRef.current)) setStage('position');
    setInstruction(reason); system(reason);
  }
  function reset() {
    cancel(); camera.current.stop(); setCameraReady(false);
    reference.current = null; calibration.current = []; calibrated.current = false;
    turns.current = {search:0,calibrate:0,guide:0,verify:0}; session.current = uid();
    setCalibrationStep(0); setStage('idle'); setError(''); setComparison(null);
    setInstruction('告诉我，你想找什么？'); setOutcome('未标注');
  }
  function setMode(value: Mode) { reset(); setModeState(value); setEvents([]); setConsent(false); }
  async function refreshHealth() {
    try { setService(await health()); } catch { setService(null); }
  }
  useEffect(() => { void refreshHealth(); }, []);
  useEffect(() => {
    const onHidden = () => { if (document.hidden) pause('页面已离开前台，拍摄和播报已停止。'); };
    document.addEventListener('visibilitychange', onHidden);
    return () => { document.removeEventListener('visibilitychange', onHidden); cancel(); camera.current.stop(); };
  }, []);
  async function ensureCamera() {
    if (mode === 'mock') return;
    if (!consent) throw new Error('请先同意将本次画面发送到配置的模型服务。');
    if (!service?.live_available) throw new Error('后端尚未配置真实模型，请先配置密钥并重启服务。');
    if (!videoRef.current) throw new Error('摄像头预览尚未准备好。');
    if (!camera.current.isActive()) await camera.current.start(videoRef.current);
    setCameraReady(true);
  }
  async function openCamera() {
    if (busyRef.current) return;
    const stamp = epoch.current; lock(true); setError('');
    try { await ensureCamera(); } catch(e) { if (stamp === epoch.current && !aborted(e)) setError(message(e)); }
    finally { if (stamp === epoch.current) lock(false); }
  }
  async function start() {
    if (busyRef.current) return;
    if (!target.trim()) { setError('请先输入或说出要找的物品。'); return; }
    if (stage === 'success') reset();
    setError(''); lock(true); const stamp = epoch.current;
    try {
      await ensureCamera();
      if (stamp !== epoch.current) return;
      if (stageRef.current === 'idle') { setStage('search'); session.current = uid(); }
      startedAt.current = Date.now();
      await say(mode === 'mock' ? `模拟演示：现在寻找${target.trim()}。不拍摄，也不调用真实模型。` : `现在寻找${target.trim()}。请缓慢扫描桌面，每次移动后稍停。`, stamp);
      if (stamp === epoch.current) setRunning(true);
    } catch(e) { if (stamp === epoch.current && !aborted(e)) setError(message(e)); }
    finally { if (stamp === epoch.current) lock(false); }
  }
  function makeRequest(phase: AnalyzeRequest['phase'], frames: Frame[]): AnalyzeRequest {
    return {session_id:session.current,request_id:uid(),mode,phase,target:target.trim(),turn:turns.current[phase],prompt_style:'accessible',frames,reference:reference.current,calibration_frames:calibration.current.slice(1),calibrated:calibrated.current,scenario,last_instruction:instruction};
  }
  async function observe(phase: AnalyzeRequest['phase'], supplied?: Frame[]) {
    if (busyRef.current) return;
    lock(true); const stamp = epoch.current; const controller = new AbortController(); requestAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const frames = supplied ?? (mode === 'mock' ? [] : phase === 'verify' ? await camera.current.captureSequence(3, 300, controller.signal) : [await camera.current.capture()]);
      if (stamp !== epoch.current) return;
      const payload = makeRequest(phase, frames);
      if (phase === 'calibrate') payload.calibration_frames = [];
      const result = await analyze(payload, controller.signal, token);
      if (stamp !== epoch.current) return;
      const invalid = validateObservation(payload, result);
      if (invalid) throw new Error(invalid);
      turns.current[phase] += 1;
      addEvent({at:new Date().toISOString(),mode,phase,instruction:result.instruction,action:result.action,latency_ms:result.latency_ms,prompt_version:result.prompt_version,kind:'model'});
      const next = nextStage(stageRef.current, result);
      if (next === 'position') { reference.current = frames.at(-1) ?? null; setRunning(false); }
      if (next === 'guide' && phase === 'calibrate') {
        calibrated.current = true; reference.current = calibration.current[0] ?? null;
        turns.current.guide = 0; turns.current.verify = 0;
      }
      setStage(next);
      if (next === 'success') { setRunning(false); camera.current.stop(); setCameraReady(false); }
      if (phase === 'calibrate' && next !== 'guide') { setCalibrationStep(0); calibration.current=[]; setRunning(false); }
      if (['uncertain','wrong_object','hold'].includes(result.action)) setRunning(false);
      await say(result.instruction, stamp);
      if (stamp === epoch.current && next === 'guide' && phase === 'calibrate') { startedAt.current=Date.now(); setRunning(true); }
    } catch(e) {
      if (stamp !== epoch.current) return;
      setRunning(false);
      const text = aborted(e) ? '等待超时，已停止。请保持手不动，重试前确认手机位置。' : message(e);
      setError(text); setInstruction(text); system(text);
      // An interrupted guidance sequence cannot resume with an old coordinate reference.
      if (mode === 'live' && ['guide','verify'].includes(stageRef.current)) { calibrated.current=false; calibration.current=[]; setStage('position'); setCalibrationStep(0); }
    } finally { clearTimeout(timeout); if (stamp === epoch.current) { lock(false); requestAbort.current=null; } }
  }
  runRef.current = async () => {
    if (Date.now() - startedAt.current > 60000) { pause('本轮已运行一分钟，已暂停。需要继续时请重新确认位置。'); return; }
    const phase = stageRef.current;
    if (phase === 'search' || phase === 'guide' || phase === 'verify') await observe(phase);
  };
  useEffect(() => {
    if (!running || busy || !['search','guide','verify'].includes(stage)) return;
    const timer = setTimeout(() => void runRef.current(), mode === 'mock' ? 750 : 1800);
    return () => clearTimeout(timer);
  }, [running, busy, stage, mode, events.length]);
  async function beginCalibration() {
    if (busyRef.current) return;
    setError(''); lock(true); const stamp=epoch.current;
    try {
      await ensureCamera(); if (stamp!==epoch.current) return;
      calibration.current=[]; calibrated.current=false; setCalibrationStep(0); setStage('calibration');
      await say(`${mode==='mock'?'模拟演示：':''}请固定手机，面向桌面，在空白处放好取物的手。手与目标需要同时入镜。准备好后，保存起始位置。`, stamp);
    } catch(e) { if(stamp===epoch.current&&!aborted(e)) setError(message(e)); }
    finally {if(stamp===epoch.current) lock(false);}
  }
  async function captureCalibration() {
    if (busyRef.current) return;
    const stamp=epoch.current; lock(true); setError('');
    try {
      if (mode==='live') calibration.current.push(await camera.current.capture());
      if (stamp!==epoch.current) return;
      if (calibrationStep < 2) {
        const next=calibrationStep+1; setCalibrationStep(next);
        await say(`${mode==='mock'?'模拟演示：':''}${next===1?'请把手向自己的右侧移动一点，停住后保存。':'请先把手放回起始位置，再向远离身体的方向移动一点，停住后保存。'}`,stamp);
      } else { lock(false); await observe('calibrate',mode==='mock'?[]:[...calibration.current]); }
    } catch(e) {if(stamp===epoch.current&&!aborted(e))setError(message(e));}
    finally {if(stamp===epoch.current)lock(false);}
  }
  async function record() {
    if (recording) { await finishRecordingRef.current(); return; }
    if (busyRef.current) return;
    if (!service?.asr_available) {setError('语音识别尚未配置。模拟模式可直接输入目标；真实识别需后端密钥。');return;}
    if (!consent) {setError('请先在设置中同意发送录音到模型服务。');return;}
    const stamp=epoch.current; lock(true); speech.current.stop(); setError('');
    try {await recorder.current.start(); if(stamp!==epoch.current)return;setRecording(true);recordingTimer.current=setTimeout(()=>void finishRecordingRef.current(),10000);}
    catch(e){if(stamp===epoch.current&&!aborted(e))setError(message(e));}
    finally{if(stamp===epoch.current)lock(false);}
  }
  finishRecordingRef.current=async()=>{
    if(!recording || busyRef.current)return;
    const stamp=epoch.current;lock(true);if(recordingTimer.current)clearTimeout(recordingTimer.current);
    const controller=new AbortController();requestAbort.current=controller;const timeout=setTimeout(()=>controller.abort(),30000);
    try{const audio=await recorder.current.stop();setRecording(false);const result=await transcribe(audio,controller.signal,token);if(stamp!==epoch.current)return;setTarget(result.text);await say(`你要找的是：${result.text}。确认无误后，请开始寻找。`,stamp);}
    catch(e){if(stamp===epoch.current){setRecording(false);setError(aborted(e)?'语音识别超时，请重试或输入目标。':message(e));}}
    finally{clearTimeout(timeout);if(stamp===epoch.current){lock(false);requestAbort.current=null;}}
  };
  async function compare() {
    if (busyRef.current || running) return;
    lock(true);const stamp=epoch.current;const controller=new AbortController();requestAbort.current=controller;const timer=setTimeout(()=>controller.abort(),45000);setError('');
    try{
      await ensureCamera();const frames=mode==='mock'?[]:[await camera.current.capture()];
      const payload=makeRequest('search',frames);
      const baseline=await analyze({...payload,prompt_style:'baseline'},controller.signal,token);
      const accessible=await analyze({...payload,request_id:uid(),prompt_style:'accessible'},controller.signal,token);
      if(stamp!==epoch.current)return;
      setComparison({baseline:baseline.instruction,accessible:accessible.instruction});
      for(const r of [baseline,accessible])addEvent({at:new Date().toISOString(),mode,phase:'search',instruction:r.instruction,action:r.action,latency_ms:r.latency_ms,prompt_version:r.prompt_version,kind:'comparison'});
    }catch(e){if(stamp===epoch.current)setError(aborted(e)?'对照请求超时。':message(e));}
    finally{clearTimeout(timer);if(stamp===epoch.current){lock(false);requestAbort.current=null;if(stageRef.current==='idle'){camera.current.stop();setCameraReady(false);}}}
  }
  function exportReport(){const blob=new Blob([reportCsv(events,outcome)],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`寻物记录-${mode}-${Date.now()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return { mode,setMode,scenario,setScenario,target,setTarget,stage,running,busy,recording,cameraReady,consent,setConsent,token,setToken,service,error,instruction,events,calibrationStep,outcome,setOutcome,comparison,videoRef,start,pause,reset,beginCalibration,captureCalibration,record,compare,exportReport,openCamera,refreshHealth,replay:()=>void say(instruction),voiceAvailable:()=>speech.current.available() };
}
