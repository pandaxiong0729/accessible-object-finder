import { useState } from 'react';
import { ArrowRight, Camera, Check, CheckCircle2, Compass, Download, Hand, Info, Mic, Pause, Play, RotateCcw, ScanLine, Settings2, ShieldCheck, Square, Volume2, AlertCircle, LoaderCircle, X } from 'lucide-react';
import { useAssistant } from './useAssistant';
import type { Scenario } from './lib/contracts';

const steps = ['寻找物品', '固定与校准', '引导取物', '核验结果'];
const phaseNames: Record<string,string> = {idle:'等待开始',search:'寻找物品',position:'等待固定手机',calibration:'方向校准',guide:'手部引导',verify:'抓取核验',success:'本轮完成'};
function DemoScene({target,active,success}:{target:string;active:boolean;success:boolean}) {
  return <div className={`demo-scene ${active?'is-scanning':''}`} aria-hidden="true">
    <div className="scene-grid"/>
    <div className="desk-shadow"/>
    <svg className="desk-drawing" viewBox="0 0 560 350" fill="none">
      <path d="M90 110 390 75 505 232 185 283Z" fill="#d8d5c6"/>
      <path d="M90 110v17l95 174v-18Z" fill="#aaa999"/><path d="M185 283v18l320-51v-18Z" fill="#bbb9a7"/>
      <path d="m122 149 103-13 42 64-108 17Z" fill="#71867c"/>
      <path d="m129 144 102-13 42 64-108 17Z" fill="#a3b0a5"/>
      <path d="m149 155 58-8m-48 24 62-8m-52 23 42-5" stroke="#e8eee6" strokeWidth="3" strokeLinecap="round"/>
      <ellipse cx="383" cy="186" rx="32" ry="15" fill="#b2b2a0" opacity=".45"/>
      <path d="M355 128h43v47c0 20-43 20-43 0Z" fill="#f3ede0"/>
      <path d="M398 141c29-2 29 32 0 31" stroke="#f3ede0" strokeWidth="9"/>
      <ellipse cx="376.5" cy="128" rx="21.5" ry="10" fill="#fffaf0"/><ellipse cx="377" cy="128" rx="15" ry="6" fill="#b8a78c"/>
      <g transform="translate(285 210) rotate(-26)"><ellipse cx="0" cy="0" rx="14" ry="18" stroke="#bb9555" strokeWidth="6"/><path d="M0 16v39h13v-8H7v-9h10" stroke="#bb9555" strokeWidth="6" strokeLinejoin="round"/><path d="M8 9 24 42l10-5-4-8 7-4" stroke="#d0b178" strokeWidth="6" strokeLinejoin="round"/></g>
    </svg>
    <div className={`target-reticle ${success?'reticle-success':''}`}><span/><span/><span/><span/><div>{success?<Check size={14}/>:<ScanLine size={14}/>} {target || '目标物品'}</div></div>
    <span className="scene-caption">示意画面 · 不代表识别结果</span>
  </div>;
}
export default function App() {
  const a = useAssistant();
  const [showHelp,setShowHelp]=useState(false);
  const stepIndex = a.stage==='idle'||a.stage==='search'?0:a.stage==='position'||a.stage==='calibration'?1:a.stage==='guide'?2:3;
  const editable = a.stage==='idle' && !a.busy && !a.recording;
  const calibrateLabels=['保存起始位置','保存向右移动后的位置','保存远离身体后的位置'];
  const active = a.running || a.busy;
  return <div className="app-shell">
    <a href="#main" className="skip-link">跳到寻物操作</a>
    <header className="site-header">
      <a href="#main" className="brand" aria-label="循物，语音寻物助手"><span className="brand-mark"><Compass size={25} strokeWidth={1.7}/></span><span>循物<span className="brand-sub">语音寻物助手</span></span></a>
      <div className="header-actions"><span className="course-tag">课程原型 <span>DEMO</span></span><button className="text-button" onClick={()=>setShowHelp(!showHelp)} aria-expanded={showHelp}><Info size={17}/>使用说明</button></div>
    </header>
    <main id="main">
      <section className="intro"><div><p className="eyebrow"><span/> 一次只做一个小动作</p><h1>说出目标，<span>一起找到。</span></h1><p className="intro-copy">从调整镜头到拿起物品，让每一步都有听得懂的提示。</p></div><div className="intro-note"><ShieldCheck size={20}/><span>桌面场景试验<br/><small>请在同伴保护下使用</small></span></div></section>
      {showHelp&&<section className="help-panel" aria-label="使用说明"><button className="icon-button help-close" aria-label="关闭说明" onClick={()=>setShowHelp(false)}><X size={18}/></button><h2>先体验，再连接真实模型</h2><p>模拟模式不拍摄、不识别，只演示流程。真实模式会将画面发送到后端配置的模型。先手持扫描，发现目标后固定手机，校准方向，再跟随短提示取物并展示核验。</p><p>只使用轻便、安全的桌面物品。暂停、移动手机或改变身体朝向后，重新固定与校准。不能用于行走避障、药品决策或危险物品。</p></section>}
      <div className="workspace">
        <section className="vision-card" aria-label="取景与语音提示">
          <div className="card-heading"><span><Camera size={17}/> {a.mode==='mock'?'模拟取景':'实时取景'}</span><span className={`status-pill ${a.mode==='mock'?'amber':''}`}><i/>{a.mode==='mock'?'模拟模式 · 非真实识别':a.cameraReady?'摄像头已开启':'摄像头未开启'}</span></div>
          <div className="viewfinder">
            <video ref={a.videoRef} muted playsInline className={a.mode==='live'&&a.cameraReady?'camera-preview':'camera-preview hidden'} aria-label="后置摄像头预览"/>
            {a.mode==='mock'?<DemoScene target={a.target} active={active} success={a.stage==='success'}/>:!a.cameraReady&&<div className="camera-empty"><Camera size={42} strokeWidth={1.2}/><h3>从你的视角开始</h3><p>授权后，镜头画面会出现在这里。</p><button className="secondary-button" onClick={()=>void a.openCamera()} disabled={a.busy}>开启摄像头</button><small>手机访问需 HTTPS 安全连接</small></div>}
            <span className="frame-corner tl"/><span className="frame-corner tr"/><span className="frame-corner bl"/><span className="frame-corner br"/>
            <div className="viewfinder-footer"><span><i className={active?'live-dot':''}/>{active?'正在观察':a.stage==='success'?'本轮已结束':'等待开始'}</span><span>后置视角 · 竖屏优先</span></div>
          </div>
          <div className={`instruction-panel ${a.stage==='success'?'success-panel':''}`}>
            <span className="instruction-icon">{a.stage==='success'?<CheckCircle2 size={23}/>:<Volume2 size={23}/>}</span>
            <div><p className="small-label">{a.stage==='success'?'核验反馈':'当前语音提示'}</p><p className="instruction" aria-live={a.voiceAvailable()?'off':'polite'} aria-atomic="true">{a.instruction}</p></div>
            <button className="icon-button replay" onClick={a.replay} aria-label="重播当前提示" disabled={a.recording}><Volume2 size={19}/></button>
          </div>
          <div className="privacy-note"><ShieldCheck size={14}/>{a.mode==='mock'?'模拟流程不申请摄像头权限，不调用真实模型。':'本站默认不保存画面和录音；发送内容由模型服务处理。'}</div>
        </section>
        <aside className="task-column" aria-label="寻物操作">
          <section className="task-card">
            <div className="section-top"><h2>开始一次寻物</h2><span className="number-label">01—04</span></div>
            <div className="mode-switch" role="group" aria-label="运行模式"><button aria-pressed={a.mode==='mock'} onClick={()=>a.setMode('mock')} disabled={!editable}>模拟体验</button><button aria-pressed={a.mode==='live'} onClick={()=>a.setMode('live')} disabled={!editable}>真实模型</button></div>
            <label className="field-label" htmlFor="target">你想找什么？</label>
            <div className="target-field"><input id="target" value={a.target} maxLength={120} onChange={e=>a.setTarget(e.target.value)} disabled={!editable} placeholder="例如：帮我找桌上的钥匙"/><button className={`mic-button ${a.recording?'recording':''}`} onClick={()=>void a.record()} disabled={a.busy||a.stage!=='idle'} aria-label={a.recording?'结束录音':'说出要找的物品'}>{a.recording?<Square size={18}/>:<Mic size={20}/>}</button></div>
            <div className="quick-targets"><span>试试找</span>{['钥匙','眼镜','遥控器'].map(item=><button key={item} onClick={()=>a.setTarget(item)} disabled={!editable}>{item}</button>)}</div>
            {a.mode==='live'&&<div className="live-consent"><label><input type="checkbox" checked={a.consent} onChange={e=>a.setConsent(e.target.checked)} disabled={a.running||a.busy}/>同意将本次画面与录音发送到配置的模型服务</label><small>{a.service?.live_available?'密钥已配置，真实调用效果尚需验证。':'后端尚未配置模型密钥，请按 README 设置。'}</small></div>}
            <div className="divider"/>
            <ol className="steps" aria-label="任务进度">{steps.map((label,index)=><li key={label} className={index===stepIndex?'current':index<stepIndex||a.stage==='success'?'complete':''} aria-current={index===stepIndex?'step':undefined}><span>{index<stepIndex||a.stage==='success'?<Check size={13}/>:index+1}</span>{label}</li>)}</ol>
            <div className="stage-summary"><span>{phaseNames[a.stage]}</span>{a.busy?<span><LoaderCircle className="spin" size={13}/>处理中</span>:<span>{a.running?'自动观察中':'等待操作'}</span>}</div>
            {a.error&&<div role="alert" className="error-message"><AlertCircle size={17}/><span>{a.error}</span></div>}
            <div className="primary-actions">
              {a.stage==='position'?<button className="primary-button" onClick={()=>void a.beginCalibration()} disabled={a.busy}><Hand size={19}/>已固定手机，开始校准<ArrowRight size={18}/></button>:a.stage==='calibration'?<button className="primary-button" onClick={()=>void a.captureCalibration()} disabled={a.busy}><Camera size={19}/>{calibrateLabels[a.calibrationStep]}<ArrowRight size={18}/></button>:a.stage==='success'?<button className="primary-button" onClick={a.reset}><RotateCcw size={19}/>开始新任务</button>:a.running?<button className="primary-button pause" onClick={()=>a.pause()}><Pause size={19}/>暂停寻找</button>:<button className="primary-button" onClick={()=>void a.start()} disabled={a.busy||a.recording}><Play size={18} fill="currentColor"/>{a.stage==='idle'?(a.mode==='mock'?'开始模拟寻找':'开始寻找'):'继续观察'}<ArrowRight size={18}/></button>}
              {a.busy&&<button className="secondary-button" onClick={()=>a.pause()}>取消当前操作</button>}
              {a.stage!=='idle'&&a.stage!=='success'&&<button className="text-button restart" onClick={a.reset}><RotateCcw size={14}/>结束并更换目标</button>}
            </div>
            <p className="action-note">{a.recording?'正在录音，最长 10 秒。点击方块结束。':a.mode==='mock'?'无需摄像头或密钥，先了解完整流程。':'每次只移动一点，停稳后等待下一条提示。'}</p>
          </section>
          <div className="support-note"><Hand size={22} strokeWidth={1.5}/><div><strong>听得懂，也做得到</strong><p>说明动作与方位，不依赖颜色或外观来指路。</p></div></div>
        </aside>
      </div>
      <section className="lower-grid">
        <details className="settings-card"><summary><span><Settings2 size={17}/>体验与连接设置</span><span className="summary-hint">展开</span></summary><div className="settings-body">
          <label className="field-label" htmlFor="scenario">模拟测试情景</label><select id="scenario" value={a.scenario} disabled={!editable||a.mode!=='mock'} onChange={e=>a.setScenario(e.target.value as Scenario)}><option value="success">正常寻找与取物</option><option value="not_found">目标不在画面中</option><option value="wrong_object">拿错物品</option><option value="occluded">手或目标被遮挡</option></select>
          <label className="field-label" htmlFor="token">访问口令（后端启用时填写）</label><input id="token" type="password" autoComplete="off" value={a.token} onChange={e=>a.setToken(e.target.value)} disabled={active} placeholder="仅在本次页面内使用，不保存"/>
          {a.mode==='mock'&&<label className="check-line"><input type="checkbox" checked={a.consent} onChange={e=>a.setConsent(e.target.checked)}/>使用录音时，同意发送录音到语音识别服务</label>}
          <div className="service-line"><span className={a.service?'connected':'disconnected'}><i/>{a.service?'后端已连接':'后端未连接'}</span><button className="text-button" onClick={()=>void a.refreshHealth()}>重新检查</button></div><p className="muted-note">真实模型：{a.service?.model??'等待连接'}。配置成功不等于能力验证完成。</p>
        </div></details>
        <details className="settings-card"><summary><span><ScanLine size={17}/>提示词对照</span><span className="summary-hint">展开</span></summary><div className="settings-body"><p>在同一画面上比较普通表达与非视觉表达。这里只展示结果，不播报、不执行动作。</p><button className="secondary-button" onClick={()=>void a.compare()} disabled={active||!a.target.trim()}>运行一次对照</button><p className="muted-note">{a.mode==='mock'?'模拟回答仅为示例，不用于证明优化效果。':'将调用两次真实模型。需要已同意上传画面。'}</p>{a.comparison&&<div className="comparison"><div><span>普通提示词</span><p>{a.comparison.baseline}</p></div><div><span>非视觉提示词</span><p>{a.comparison.accessible}</p></div></div>}</div></details>
      </section>
      <section className="session-card" aria-label="本次任务记录"><div className="section-top"><div><h2>本次任务记录 <span className="count">{a.events.length}</span></h2><p>模型判断与人工结果分别记录，不自动生成成功率。</p></div><button className="secondary-button export" onClick={a.exportReport} disabled={!a.events.length}><Download size={15}/>导出 CSV</button></div><div className="outcome-row"><label htmlFor="outcome">人工核对结果</label><select id="outcome" value={a.outcome} onChange={e=>a.setOutcome(e.target.value)}><option>未标注</option><option>独立拿到正确物品</option><option>帮助后完成</option><option>拿错物品</option><option>未完成</option><option>中止</option></select><span>仅手动填写；模拟记录不计入真实效果。</span></div>{a.events.length?<ol className="event-list">{a.events.slice(-6).reverse().map((event,index)=><li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString('zh-CN',{hour12:false})}</time><span className={`event-mode ${event.mode==='mock'?'mock':''}`}>{event.mode==='mock'?'模拟':'真实'}</span><p>{event.instruction}</p><small>{event.kind==='comparison'?'对照':event.kind==='system'?'操作':`${event.latency_ms} ms`}</small></li>)}</ol>:<div className="empty-log"><span/>开始任务后，提示与结果会显示在这里。记录仅保留在当前页面。</div>}</section>
    </main>
    <footer><span>循物 · 视障辅助课程原型</span><span>仍在验证中，不能替代可靠的人工协助。</span></footer>
  </div>;
}
