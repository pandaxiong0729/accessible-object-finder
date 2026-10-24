// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraService, RecorderService, SpeechService } from './media';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeStream() {
  let state: MediaStreamTrackState = 'live';
  const track = {
    get readyState() { return state; },
    stop: vi.fn(() => { state = 'ended'; }),
  };
  return {
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    track,
  };
}

function makeVideo(ready = true, width = 1920, height = 1080) {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    readyState: { value: ready ? 4 : 0, configurable: true },
    videoWidth: { value: ready ? width : 0, configurable: true },
    videoHeight: { value: ready ? height : 0, configurable: true },
  });
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();
  return video;
}

let getUserMedia = vi.fn();

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CameraService', () => {
  it('requests the rear camera and encodes unmirrored JPEG with a 960px maximum edge', async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,ZmFrZQ==');
    const camera = new CameraService();
    const video = makeVideo();
    await camera.start(video);
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: false, video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
    }));
    expect(video.playsInline).toBe(true);
    expect(camera.isActive()).toBe(true);
    const frame = await camera.capture();
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 960, 540);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.75);
    expect(frame).toMatchObject({ data_url: 'data:image/jpeg;base64,ZmFrZQ==', captured_at_ms: expect.any(Number), id: expect.any(String) });
    camera.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(camera.isActive()).toBe(false);
  });

  it('waits for actual pixels before resolving camera start', async () => {
    getUserMedia.mockResolvedValue(makeStream().stream);
    const video = makeVideo(false);
    const camera = new CameraService();
    const started = vi.fn();
    const start = camera.start(video).then(started);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).not.toHaveBeenCalled();
    Object.defineProperties(video, {
      readyState: { value: 4 }, videoWidth: { value: 640 }, videoHeight: { value: 480 },
    });
    video.dispatchEvent(new Event('loadeddata'));
    await start;
    expect(started).toHaveBeenCalledOnce();
    camera.stop();
  });

  it('rejects insecure contexts before asking permission', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(new CameraService().start(makeVideo())).rejects.toThrow('HTTPS');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('provides a Chinese permission error', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await expect(new CameraService().start(makeVideo())).rejects.toThrow('摄像头权限未开启');
  });

  it('releases late permission grants after stop instead of resurrecting the camera', async () => {
    const grant = deferred<MediaStream>();
    const { stream, track } = makeStream();
    getUserMedia.mockReturnValue(grant.promise);
    const camera = new CameraService();
    const video = makeVideo();
    const start = camera.start(video);
    const rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' });
    camera.stop();
    await rejected;
    grant.resolve(stream);
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(camera.isActive()).toBe(false);
  });

  it('does not let an old permission result stop a newly started camera', async () => {
    const grant = deferred<MediaStream>();
    const old = makeStream();
    const current = makeStream();
    getUserMedia.mockReturnValueOnce(grant.promise).mockResolvedValueOnce(current.stream);
    const camera = new CameraService();
    const oldStart = camera.start(makeVideo());
    const rejected = expect(oldStart).rejects.toMatchObject({ name: 'AbortError' });
    await camera.start(makeVideo());
    grant.resolve(old.stream);
    await rejected;
    expect(old.track.stop).toHaveBeenCalledOnce();
    expect(current.track.stop).not.toHaveBeenCalled();
    expect(camera.isActive()).toBe(true);
    camera.stop();
  });

  it('cancels pending pixel readiness and releases its stream', async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const camera = new CameraService();
    const start = camera.start(makeVideo(false));
    const rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    camera.stop();
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('times out and releases a stream that never produces video pixels', async () => {
    vi.useFakeTimers();
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const camera = new CameraService();
    const starting = camera.start(makeVideo(false));
    const rejected = expect(starting).rejects.toThrow('等待摄像头画面超时');
    await vi.advanceTimersByTimeAsync(12_000);
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(camera.isActive()).toBe(false);
  });

  it('captures fresh ordered sequence frames and honors the interval', async () => {
    vi.useFakeTimers();
    getUserMedia.mockResolvedValue(makeStream().stream);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,ZmFrZQ==');
    const camera = new CameraService();
    await camera.start(makeVideo());
    const capturing = camera.captureSequence(3, 200);
    await vi.runAllTimersAsync();
    const frames = await capturing;
    expect(frames).toHaveLength(3);
    expect(frames[1].captured_at_ms - frames[0].captured_at_ms).toBe(200);
    expect(frames[2].captured_at_ms - frames[1].captured_at_ms).toBe(200);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(3);
    camera.stop();
  });

  it('aborting a sequence releases the stream and rejects without returning partial evidence', async () => {
    vi.useFakeTimers();
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,ZmFrZQ==');
    const camera = new CameraService();
    await camera.start(makeVideo());
    const control = new AbortController();
    const capturing = camera.captureSequence(3, 200, control.signal);
    const rejected = expect(capturing).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(50);
    control.abort();
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(camera.isActive()).toBe(false);
  });

  it('rejects capture without a running camera and invalid sequence input', async () => {
    const camera = new CameraService();
    await expect(camera.capture()).rejects.toThrow('尚未就绪');
    await expect(camera.captureSequence(0, 100)).rejects.toThrow('正整数');
  });
});

class UtteranceMock {
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

describe('SpeechService', () => {
  function setup() {
    const chinese = { lang: 'zh-CN', name: 'Chinese' };
    const synthesis = {
      getVoices: vi.fn(() => [{ lang: 'en-US', name: 'English' }, chinese]),
      speak: vi.fn(), cancel: vi.fn(),
    };
    vi.stubGlobal('SpeechSynthesisUtterance', UtteranceMock);
    vi.stubGlobal('speechSynthesis', synthesis);
    return { synthesis, chinese, service: new SpeechService() };
  }

  it('prefers a Chinese voice and waits until speech ends', async () => {
    const { service, synthesis, chinese } = setup();
    const done = vi.fn();
    const speaking = service.speak('请把手机放稳').then(done);
    const utterance = synthesis.speak.mock.calls[0][0] as UtteranceMock;
    expect(utterance.voice).toBe(chinese);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    utterance.onend?.();
    await speaking;
    expect(done).toHaveBeenCalledOnce();
  });

  it('settles pending speech when stopped or replaced', async () => {
    const { service } = setup();
    const first = service.speak('第一句');
    const second = service.speak('第二句');
    await expect(first).resolves.toBeUndefined();
    service.stop();
    await expect(second).resolves.toBeUndefined();
  });

  it('uses a bounded fallback if the engine never sends onend', async () => {
    vi.useFakeTimers();
    const { service, synthesis } = setup();
    const speaking = service.speak('请停下');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(speaking).resolves.toBeUndefined();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it('is safe when browser speech is unavailable', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const service = new SpeechService();
    expect(service.available()).toBe(false);
    await expect(service.speak('请停下')).resolves.toBeUndefined();
    service.stop();
  });
});

let recorders: RecorderMock[] = [];
let automaticallyStop = true;
class RecorderMock {
  static isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus');
  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    recorders.push(this);
  }
  start = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => {
    this.state = 'inactive';
    if (automaticallyStop) queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['audio bytes']) } as BlobEvent);
      this.onstop?.();
    });
  });
}

describe('RecorderService', () => {
  beforeEach(() => {
    recorders = [];
    automaticallyStop = true;
    RecorderMock.isTypeSupported.mockImplementation((type) => type === 'audio/webm;codecs=opus');
    vi.stubGlobal('MediaRecorder', RecorderMock);
  });

  it('requests microphone only and returns a data URL with a supported base MIME', async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const recorder = new RecorderService();
    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(recorders[0].mimeType).toBe('audio/webm;codecs=opus');
    const result = await recorder.stop();
    expect(result).toMatch(/^data:audio\/webm;base64,/);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('chooses mp4 on browsers that do not support WebM', async () => {
    RecorderMock.isTypeSupported.mockImplementation((type) => type === 'audio/mp4');
    getUserMedia.mockResolvedValue(makeStream().stream);
    const recorder = new RecorderService();
    await recorder.start();
    expect(await recorder.stop()).toMatch(/^data:audio\/mp4;base64,/);
  });

  it('releases a late microphone grant after cancel', async () => {
    const grant = deferred<MediaStream>();
    const { stream, track } = makeStream();
    getUserMedia.mockReturnValue(grant.promise);
    const recorder = new RecorderService();
    const started = recorder.start();
    const rejected = expect(started).rejects.toMatchObject({ name: 'AbortError' });
    recorder.cancel();
    await rejected;
    grant.resolve(stream);
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorders).toHaveLength(0);
  });

  it('cancels an in-progress stop and settles its pending promise', async () => {
    automaticallyStop = false;
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const recorder = new RecorderService();
    await recorder.start();
    const stopping = recorder.stop();
    const rejected = expect(stopping).rejects.toMatchObject({ name: 'AbortError' });
    recorder.cancel();
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorders[0].onstop).toBeNull();
  });

  it('reports permissions and unsupported browser errors without leaving media active', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await expect(new RecorderService().start()).rejects.toThrow('麦克风权限未开启');
    vi.stubGlobal('MediaRecorder', undefined);
    await expect(new RecorderService().start()).rejects.toThrow('不支持录音');
  });

  it('bounds the wait when MediaRecorder never stops', async () => {
    vi.useFakeTimers();
    automaticallyStop = false;
    getUserMedia.mockResolvedValue(makeStream().stream);
    const recorder = new RecorderService();
    await recorder.start();
    const stopping = recorder.stop();
    const rejected = expect(stopping).rejects.toThrow('保存录音超时');
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
  });

  it('rejects an empty recording instead of returning an empty upload', async () => {
    automaticallyStop = false;
    getUserMedia.mockResolvedValue(makeStream().stream);
    const recorder = new RecorderService();
    await recorder.start();
    const stopping = recorder.stop();
    const rejected = expect(stopping).rejects.toThrow('没有录到声音');
    recorders[0].onstop?.();
    await rejected;
  });

  it('releases media and records an asynchronous recorder error', async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const recorder = new RecorderService();
    await recorder.start();
    recorders[0].onerror?.();
    await expect(recorder.stop()).rejects.toThrow('录音失败');
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
