import type { AnalyzeRequest, Health, Observation } from './contracts';
async function request<T>(path: string, options: RequestInit = {}, token = ''): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...(token ? {'X-App-Access-Token': token} : {}), ...options.headers },
  });
  if (!response.ok) {
    let detail = `请求失败（${response.status}），请稍后重试。`;
    try { const body = await response.json(); if (typeof body.detail === 'string') detail = body.detail; } catch { /* non-JSON proxy error */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}
export const health = () => request<Health>('/health');
export const analyze = (body: AnalyzeRequest, signal: AbortSignal, token: string) => request<Observation>('/analyze', {method:'POST',body:JSON.stringify(body),signal},token);
export const transcribe = (audio: string, signal: AbortSignal, token: string) => request<{text:string}>('/transcribe',{method:'POST',body:JSON.stringify({audio_data_url:audio}),signal},token);
