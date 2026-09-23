# 本地实时语音输入

输入器平时只显示一个麦克风；点击后底部原工具栏暂时隐藏，替换为灰色点线、右侧短波形、取消、停止、发送。顶部继续使用宿主原生草稿编辑器。插件自己的听写、语音消息、录音浮条与快捷键入口不再注册，设置页和后端保留。

## 识别链路

AudioWorklet 持续采集单声道 PCM，约每 200ms 把新增帧经已鉴权的 `/api/zhuanleme` 发给本地 `voice_stream` 工具。工具仅允许 loopback HTTP 地址，转交现有 Python 服务的 `/api/v1/stream`。使用有序 HTTP 帧保持同一个在线识别状态，而不是重复识别整段录音。

- Zipformer 中文在线模型：连续消费新音频，直接返回当前文字。
- SenseVoice：模型检测到停顿或用户停止时，对当前句做第二遍识别，修正文字、数字和标点。
- 前端替换当前识别假设，保留之前输入的草稿；不使用逐字动画模拟识别。

真实流式识别也可能每次返回几个字，且存在首字延迟；句尾文字可能修正。公开测试音频的离线逐帧测试观察到 12 次文本更新，首字位于音频约 1.6 秒，完整约 5.6 秒。这里包含样例原有静音和模型上下文需求，不是对其他设备/环境的延迟承诺。

官方依据：
- [sherpa-onnx 中文流式 Zipformer](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html#sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30-chinese)
- [官方流式服务示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/streaming_server.py)
- [FunASR 在线识别与句尾纠错协议](https://github.com/modelscope/FunASR/blob/main/runtime/docs/websocket_protocol_zh.md)

不需要 API Key，不使用浏览器云端 SpeechRecognition。音频由本机服务处理；首次使用仍需用户给予浏览器麦克风权限。

## 草稿和生命周期

取消撤回本次听写，恢复录音前草稿；停止保留最终文字；发送和编辑器 Enter 都先冲刷 AudioWorklet 尾帧、处理剩余音频、获得最终文字再调用宿主 submit。Shift+Enter 仍换行。手动编辑导致草稿与上一次识别写入不一致时，停止识别并保留手动编辑，避免覆盖。切换会话、卸载、设备断开和错误均释放音频资源、取消后续写入。最多连续录音两分钟。

服务对每段录音使用随机 id 和递增序号，拒绝乱序/重复帧。前端限制积压，服务最多四个同时存在的录音，20 秒无请求或150秒绝对时限清理。会话音频仅保存在内存用于句尾修正，不写录音文件。

## 验证

- `tests/voice-stream.test.mjs`：PCM 编码、串行上传、尾帧、取消、网络失败、草稿修正与手动编辑保护。
- 项目根 `plugins/dsh-voice/tests/streaming-model-check.py`：真实两个模型测试增量中文、最终修正、静音、乱序、取消。
- 项目根 `plugins/dsh-voice/tests/product-audio-check.mjs`：已鉴权 API 与原整段识别回归。
- `tests/voice-browser/build.mjs`：生成仅通过临时 Profile overlay 挂载的验证页面；使用公开中文样例合成 MediaStream，走真实 AudioWorklet 与后端，不访问麦克风。测试页面的发送仅记录本地测试输出，不发送模型消息。

浏览器检查涵盖单入口、正在录音时输入框出现中间结果、取消、停止、最终发送、会话切换与权限拒绝。桌面和窄屏布局均作检查。正式启动不加载测试 overlay。
