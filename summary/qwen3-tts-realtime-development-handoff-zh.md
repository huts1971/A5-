# Qwen3-TTS Realtime 适配开发交接

## 1. 本次目标

在保持 A5 现有 LLM、RAG、联网补充和文字回答链路不变的前提下，将
OpenAvatarChat 的 TTS 从百炼 CosyVoice 切换为：

```text
qwen3-tts-instruct-flash-realtime-2026-01-22
```

TTS 继续由 OpenAvatarChat 接管，生成的流式音频直接驱动 LiteAvatar。LiteAvatar
整体接入边界、产品需求和任务拆分请参见：

- `PRD/openavatarchat-liteavatar-guide-prd-zh.md`
- `Issues/00-openavatarchat-liteavatar-guide-breakdown-proposal.md`
- `Issues/01-avatar-service-local-foundation.md` 至
  `Issues/06-remove-legacy-avatar-and-document-runbook.md`

## 2. 当前实现状态

本次新增了独立的 Qwen3-TTS Realtime Handler：

```text
avatar-service/openavatar/qwen_tts_realtime/
  __init__.py
  pyproject.toml
  tts_handler_qwen_tts_realtime.py
```

关键行为：

- 使用 `DASHSCOPE_API_KEY`，不在代码或配置模板中保存真实密钥。
- 默认模型固定为
  `qwen3-tts-instruct-flash-realtime-2026-01-22`，避免浮动版本变化。
- 默认音色为 `Cherry`，语言为 `Chinese`。
- 使用百炼 Qwen-TTS Realtime WebSocket 协议。
- 将回答文本增量提交到同一个实时 TTS 会话，最后一个文本块到达后调用
  `finish()`。
- 将 `response.audio.delta` 中的 Base64 PCM 立即转换为 24 kHz、单声道、
  `float32` 音频帧并提交给 LiteAvatar。
- 在 `response.done`、`session.finished` 或服务端错误时只结束一次 Avatar
  音频流。
- 文本发送完成后仍保留活动会话，直到音频真正结束，因此游客发起新问题时仍可
  取消尚在生成或播放的旧念白。
- 中断时调用取消、清空和关闭方法；TTS 故障不会改变 A5 已生成的文字回答。

默认 OpenAvatarChat 配置已切换到新 Handler：

```text
avatar-service/openavatar/a5_liteavatar.yaml
```

安装脚本也已更新：

```text
avatar-service/setup-avatar.ps1
```

脚本会将受版本控制的 Handler 源码复制到被忽略的上游目录：

```text
avatar-service/vendor/OpenAvatarChat/src/handlers/tts/qwen_tts_realtime/
```

不要只修改 `vendor/OpenAvatarChat` 中的副本。运行安装脚本或重新检出固定上游提交
后，该目录会被重新生成；源码真源是 `avatar-service/openavatar/`。

## 3. TDD 与验证结果

行为测试位于：

```text
avatar-service/openavatar/tests/test_qwen_tts_realtime_handler.py
```

覆盖：

- 音频增量立即进入 LiteAvatar。
- PCM 数值与形状转换正确。
- 完成事件只关闭一次输出流。
- 服务端错误能正确结束输出流。
- 默认模型、音色、采样率和语言配置正确。
- 多个文本块复用同一个实时会话。
- 最终文本提交后会话仍可被打断。
- YAML 和安装脚本确实使用并部署新 Handler。

已完成的验证：

```text
Qwen3-TTS Handler tests: 6 passed
Avatar bridge tests:     21 passed
Python py_compile:       passed
git diff --check:        passed（仅有现有 Windows 换行提示）
setup-avatar.ps1:        passed，成功发现 QwenTTS Handler
```

使用本地环境变量中的有效密钥进行过一次真实百炼调用：

```text
模型：qwen3-tts-instruct-flash-realtime-2026-01-22
结果：成功返回 76,800 字节 24 kHz PCM
```

真实密钥未写入本文档。`avatar-service/.env` 已被 Git 忽略。

## 4. 运行与复验

首次安装或重新同步 Handler：

```powershell
powershell -ExecutionPolicy Bypass -File avatar-service\setup-avatar.ps1 -SkipModels
```

完整安装使用：

```bat
SETUP-AVATAR.bat
```

联合启动：

```bat
START-HERE.bat
```

针对性测试：

```powershell
cd avatar-service\vendor\OpenAvatarChat
.\.venv\Scripts\python.exe -m pytest -q ..\..\openavatar\tests\test_qwen_tts_realtime_handler.py
```

Avatar bridge 回归测试：

```powershell
cd avatar-service
.\.venv\Scripts\python.exe -m pytest -q tests
```

人工复验建议在 `/guide` 完成：

1. 发送一个能产生多段流式回答的问题，确认回答尚未结束时数字人已开始念白。
2. 念白过程中发送第二个问题，确认旧念白立即停止。
3. 确认文字回答、来源卡片和 A5 问答结果不受 TTS 成败影响。
4. 停止 Avatar 服务后再次提问，确认页面降级但文字链路继续完成。

## 5. 已知边界

- 当前只验收本地单浏览器、单 Avatar session。
- 默认未配置 `instructions`，保留后续开发更有人情味的表达风格；Handler 已支持
  从 YAML 传入该字段。
- 默认使用百炼公共 WebSocket 地址。若账号采用专属 Workspace 或地域地址，需要
  再为配置模型补充相应字段并增加行为测试。
- 本次没有修改 A5 backend 的 LLM、RAG、联网检索或回答风格。
- 工作区包含此前 LiteAvatar 集成产生的多项未提交改动，后续操作不得回退或覆盖
  与本次无关的现有变更。

## 6. Suggested Skills

后续继续开发时建议使用：

- `$tdd`：修改流式协议、打断、错误恢复或音频格式时保持逐条红绿循环。
- `$karpathy-guidelines`：限制适配层范围，避免改动 OpenAvatarChat 和 A5
  回答链路中的无关代码。
- `$diagnose`：真实 `/guide` 念白出现卡顿、断流、状态不结束或延迟回退时使用。
- `$grill-me`：开始设计 `instructions`、音色、情绪或回答风格策略前重新确认产品
  边界。
