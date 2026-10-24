# 后台运行与边界

在项目根目录安装 `requirements.txt`，复制 `.env.example` 为本机 `.env`，然后运行：

```text
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
python -m pytest backend/tests -q
```

`GET /api/health` 的 available 只表示已填写配置，不表示密钥、模型或服务可用。模拟无需密钥，所有模拟播报包含“模拟演示，不是真实识别”。真实模式缺配置、超时或输出不合规会明确失败，绝不自动退回模拟。

`MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME` 配置视觉接口。`ASR_MODEL` 配置同一服务的语音模型；留空可禁用服务端语音。默认的旧 DashScope 域名在官方文档中仍被说明可用，也可使用自己地区与工作空间的兼容接口域名。密钥必须匹配地区。

`APP_ACCESS_TOKEN` 非空时，`POST /api/analyze`、`POST /api/transcribe` 必须提供 `X-App-Access-Token`；公开 health 不包含口令或密钥。浏览器只应在当前会话保存该口令，不要放在 URL、本地持久存储或导出文件里。未设口令仅适用于受控本机/课堂，不应公开暴露端口。远程手机摄像头需 HTTPS；开发服务不是生产级部署。

请求 JSON 上限 9 MiB，超限 HTTP 413。每 IP 默认每分钟 30 次 POST，每进程同时最多两个模型请求。限流不信任客户端提供的转发 IP，反向代理后可能多人共享一个额度；多进程没有共享限流。生产部署需网关身份认证、统一限流、TLS 和成本管理。

图片仅接受真实 JPEG/PNG base64，每张解码不超过 1 MiB、最长边不超过 4096、最多 1200 万像素，不接受远程 URL。每请求包括历史参照及校准在内最多 6 张。程序不保存/记录图片、音频、目标内容或供应商响应。不要启用 HTTP body 调试日志，也不要在反向代理记录请求体。`httpx` 不继承环境代理、不跟随重定向。

语音接受 base64 WAV/WebM/OGG/MP4/MPEG，最大 3 MiB；检查 MIME、编码及容器文件头。WAV 校验最长约 10 秒；其他容器本版没有完整音频解码器，时长限制依靠浏览器 10 秒停止录音，供应商仍可能拒绝损坏/不支持的内容。服务端不会伪造识别文本。上传第三方模型服务前，前端必须获得用户同意。服务端不落盘不等于第三方完全不处理或留存，需另行确认服务商条款。

固定机位校准三帧依次为原点、从原点向用户自身右移、先回原点再远离身体。引导与核验的 reference 必须使用固定机位的原点帧；不能使用手持扫描旧帧。两张 calibration_frames 为右移与远离身体。服务器只做数据、时效和模型输出的门控，不独立检测真实姿态变化；机位改变、遮挡、错误方向映射仍须依靠模型拒识、前端暂停和同伴保护。

真实 guide 的行动输出必须在当前图片采集后 6 秒内返回，否则改为停手；verify 成功也要求最新图片未超过 6 秒。三张核验帧须编号、内容不同且时间递增，10 秒内连续采集、晚于历史参照。客户端时钟需正确，服务端容忍 5 秒未来偏差。校准图片最多 60 秒旧，其他当前图片最多 30 秒旧；超过会拒绝请求。这里没有从单张照片估计深度或证明握牢的能力。

提示词产生视觉判断及动作枚举；安全层把实际行动播报规范为单句，防止同一输出里夹带相反或额外动作。`baseline` 只在 reason 中提供观察对照，永不变成现场行动指令。全局成功需要目标身份相符、可见手持、离桌及新鲜多帧证据；不能用二维重叠或目标消失替代。即使通过门控，模型仍会犯错，本版只能用于同伴看护的安全桌面课程实验。

官方接口依据（2026-10-22 核对）：

- 图像输入：<https://help.aliyun.com/zh/model-studio/vision>
- Qwen-ASR 兼容接口：<https://help.aliyun.com/en/model-studio/qwen-asr-api-reference>
- JSON Object 输出：<https://help.aliyun.com/en/model-studio/qwen-structured-output>

语音发送到 `/chat/completions`，内容为 `{"type":"input_audio","input_audio":{"data":"data:audio/...;base64,..."}}`，不是 Whisper 的文件上传接口。测试使用本地 `httpx.MockTransport`，不验证真实账号可用性或真实识别效果。
