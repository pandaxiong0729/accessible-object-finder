import type { Frame } from './contracts';

function cancelled(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function requireMedia(device: '摄像头' | '麦克风'): MediaDevices {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    throw new Error(`使用${device}需要 HTTPS 或本机 localhost，请通过安全地址打开页面。`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(`当前浏览器不支持${device}访问，请使用新版 Safari 或 Chrome。`);
  }
  return navigator.mediaDevices;
}

function mediaError(error: unknown, device: '摄像头' | '麦克风'): Error {
  // DOMException may belong to a different realm and need not pass instanceof Error.
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'AbortError') return cancelled();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new Error(`${device}权限未开启，请在浏览器设置中允许访问后重试。`);
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error(`没有找到可用的${device}。`);
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new Error(`${device}暂时不可用，可能被其他应用占用，请关闭占用后重试。`);
  }
  if (name === 'OverconstrainedError') {
    return new Error(`${device}不支持请求的配置，请更换设备或浏览器。`);
  }
  return error instanceof Error ? error : new Error(`无法启动${device}，请重试。`);
}

function release(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function acquireMedia(media: MediaDevices, constraints: MediaStreamConstraints, signal: AbortSignal): Promise<MediaStream> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      media.getUserMedia(constraints).then((stream) => {
        signal.removeEventListener('abort', onAbort);
        // Permission prompts are not abortable, even though their caller can be cancelled.
        if (settled || signal.aborted) {
          release(stream);
          return;
        }
        settled = true;
        resolve(stream);
      }, (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      settled = true;
      reject(error);
    }
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function readyVideo(video: HTMLVideoElement, signal: AbortSignal, play: boolean): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let playbackReady = !play;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('canplay', check);
      video.removeEventListener('playing', check);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (playbackReady && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const onAbort = () => finish(cancelled());
    const onError = () => finish(new Error('摄像头画面无法播放，请重新开启摄像头。'));
    const timer = setTimeout(() => finish(new Error('等待摄像头画面超时，请检查摄像头后重试。')), 12_000);
    video.addEventListener('loadeddata', check);
    video.addEventListener('canplay', check);
    video.addEventListener('playing', check);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (play) {
      try {
        Promise.resolve(video.play()).then(() => {
          playbackReady = true;
          check();
        }, () => finish(new Error('浏览器未能播放摄像头画面，请点击开启摄像头后重试。')));
      } catch {
        finish(new Error('浏览器未能播放摄像头画面，请点击开启摄像头后重试。'));
      }
    } else {
      check();
    }
  });
}

/** Owns one camera stream. Frames stay in memory and are never uploaded here. */
export class CameraService {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private generation = 0;
  private lifetime: AbortController | null = null;
  private ready = false;
  private frameCounter = 0;

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    const media = requireMedia('摄像头');
    const generation = this.generation;
    const lifetime = new AbortController();
    this.lifetime = lifetime;
    try {
      const stream = await acquireMedia(media, {
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      }, lifetime.signal);
      // getUserMedia cannot be aborted: dispose permission results arriving after stop/restart.
      if (generation !== this.generation || lifetime.signal.aborted) {
        release(stream);
        throw cancelled();
      }
      this.stream = stream;
      this.video = video;
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;
      await readyVideo(video, lifetime.signal, true);
      if (generation !== this.generation) throw cancelled();
      this.ready = true;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw mediaError(error, '摄像头');
    }
  }

  isActive(): boolean {
    return this.ready && !!this.stream && !!this.video
      && this.video.srcObject === this.stream
      && this.stream.getVideoTracks().some((track) => track.readyState === 'live');
  }

  async capture(): Promise<Frame> {
    const video = this.video;
    const lifetime = this.lifetime;
    const generation = this.generation;
    if (!this.isActive() || !video || !lifetime) throw new Error('摄像头尚未就绪，请先开启摄像头。');
    await readyVideo(video, lifetime.signal, false);
    if (generation !== this.generation || !this.isActive()) throw cancelled();
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法生成摄像头图片，请更换浏览器。');
    // Capture original pixels, regardless of any CSS applied to the preview.
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const capturedAt = Date.now();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('摄像头图片生成失败，请重试。');
    this.frameCounter += 1;
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `frame-${capturedAt}-${this.frameCounter}`,
      captured_at_ms: capturedAt,
      data_url: dataUrl,
    };
  }

  async captureSequence(count: number, intervalMs: number, signal?: AbortSignal): Promise<Frame[]> {
    if (!Number.isInteger(count) || count < 1 || !Number.isFinite(intervalMs) || intervalMs < 0) {
      throw new Error('拍摄张数必须为正整数，间隔必须为非负毫秒数。');
    }
    const generation = this.generation;
    const lifetime = this.lifetime;
    if (!this.isActive() || !lifetime) throw new Error('摄像头尚未就绪，请先开启摄像头。');
    const onAbort = () => {
      if (generation === this.generation) this.stop();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal?.aborted) {
        onAbort();
        throw cancelled();
      }
      const frames: Frame[] = [];
      for (let index = 0; index < count; index += 1) {
        if (generation !== this.generation || lifetime.signal.aborted) throw cancelled();
        if (index > 0) await delay(Math.max(1, intervalMs), lifetime.signal);
        frames.push(await this.capture());
      }
      if (signal?.aborted || generation !== this.generation) throw cancelled();
      return frames;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  stop(): void {
    this.generation += 1;
    this.ready = false;
    this.lifetime?.abort();
    this.lifetime = null;
    release(this.stream);
    this.stream = null;
    if (this.video) {
      try { this.video.pause(); } catch { /* Already detached media is safe to release. */ }
      this.video.srcObject = null;
      this.video = null;
    }
  }
}

/** Browser speech synthesis; stopping/replacing speech always settles its waiter. */
export class SpeechService {
  private finish: (() => void) | null = null;

  available(): boolean {
    return typeof window !== 'undefined' && !!window.speechSynthesis
      && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  speak(text: string): Promise<void> {
    this.stop();
    if (!text.trim() || !this.available()) return Promise.resolve();
    return new Promise((resolve) => {
      const synthesis = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      const voices = synthesis.getVoices();
      const voice = voices.find((item) => /^zh[-_]CN$/i.test(item.lang))
        ?? voices.find((item) => /^zh(?:[-_]|$)/i.test(item.lang));
      if (voice) utterance.voice = voice;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        utterance.onend = null;
        utterance.onerror = null;
        if (this.finish === finish) this.finish = null;
        resolve();
      };
      // Some mobile engines omit onend, especially after interruptions.
      const timer = setTimeout(() => {
        finish();
        synthesis.cancel();
      }, Math.min(60_000, Math.max(10_000, text.length * 220 + 4_000)));
      this.finish = finish;
      utterance.onend = finish;
      utterance.onerror = finish;
      try { synthesis.speak(utterance); } catch { finish(); }
    });
  }

  stop(): void {
    this.finish?.();
    this.finish = null;
    if (this.available()) window.speechSynthesis.cancel();
  }
}

/** Microphone recording only. Encoding is local; the caller decides whether to upload. */
export class RecorderService {
  private stream: MediaStream | null = null;
  private lifetime: AbortController | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private generation = 0;
  private reader: FileReader | null = null;
  private failure: Error | null = null;
  private stopping: Promise<string> | null = null;
  private resolveStop: ((data: string) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    this.cancel();
    this.failure = null;
    const media = requireMedia('麦克风');
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持录音，请直接输入物品名称。');
    const generation = this.generation;
    const lifetime = new AbortController();
    this.lifetime = lifetime;
    try {
      const stream = await acquireMedia(media, { audio: true, video: false }, lifetime.signal);
      if (generation !== this.generation) {
        release(stream);
        throw cancelled();
      }
      this.stream = stream;
      const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.recorder = recorder;
      this.chunks = [];
      recorder.ondataavailable = (event) => {
        if (generation === this.generation && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.failure = new Error('录音失败，请检查麦克风后重试，或直接输入物品名称。');
        this.finishRecording(undefined, this.failure);
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        release(this.stream);
        this.stream = null;
        if (!this.stopping) {
          this.failure = new Error('录音已中断，请重新录音或直接输入物品名称。');
          this.finishRecording(undefined, this.failure);
          return;
        }
        const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
        if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'].includes(type)) {
          this.finishRecording(undefined, new Error('当前浏览器的录音格式不受支持，请直接输入物品名称。'));
          return;
        }
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        if (!blob.size) {
          this.finishRecording(undefined, new Error('没有录到声音，请重新录音。'));
          return;
        }
        const reader = new FileReader();
        this.reader = reader;
        reader.onload = () => {
          if (generation !== this.generation) return;
          if (typeof reader.result === 'string') this.finishRecording(reader.result);
          else this.finishRecording(undefined, new Error('录音数据读取失败，请重试。'));
        };
        reader.onerror = () => {
          if (generation === this.generation) this.finishRecording(undefined, new Error('录音数据读取失败，请重试。'));
        };
        try {
          reader.readAsDataURL(blob);
        } catch {
          this.finishRecording(undefined, new Error('录音数据读取失败，请重试。'));
        }
      };
      recorder.start(250);
    } catch (error) {
      if (generation === this.generation) this.cancel();
      throw mediaError(error, '麦克风');
    }
  }

  stop(): Promise<string> {
    if (this.stopping) return this.stopping;
    if (!this.recorder || this.recorder.state === 'inactive') {
      const error = this.failure ?? new Error('录音尚未开始或已经结束。');
      this.cancel();
      return Promise.reject(error);
    }
    const promise = new Promise<string>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    this.stopping = promise;
    this.stopTimer = setTimeout(() => {
      this.finishRecording(undefined, new Error('保存录音超时，请重新录音或直接输入物品名称。'));
    }, 8_000);
    try {
      this.recorder.stop();
      release(this.stream);
      this.stream = null;
    } catch {
      this.finishRecording(undefined, new Error('无法结束录音，请重新录音。'));
    }
    return promise;
  }

  private finishRecording(data?: string, error?: Error): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* Stream release below is unconditional. */ }
      }
    }
    release(this.stream);
    this.stream = null;
    if (this.reader) {
      this.reader.onload = null;
      this.reader.onerror = null;
      if (this.reader.readyState === FileReader.LOADING) this.reader.abort();
      this.reader = null;
    }
    this.chunks = [];
    const resolve = this.resolveStop;
    const reject = this.rejectStop;
    this.resolveStop = null;
    this.rejectStop = null;
    this.stopping = null;
    if (error) {
      this.failure = error;
      reject?.(error);
    } else if (data !== undefined) {
      resolve?.(data);
    }
  }

  cancel(): void {
    this.generation += 1;
    this.lifetime?.abort();
    this.lifetime = null;
    this.finishRecording(undefined, cancelled());
  }
}
