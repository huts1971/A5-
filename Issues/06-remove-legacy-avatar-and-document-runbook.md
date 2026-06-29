# 清理 `/guide` 旧数字人口播主链路并补本地运行文档

类型：AFK

状态：已完成（2026-06-28）

覆盖用户故事：18、19、21、28、36

## What to build

在 LiteAvatar 的文字、语音、打断和降级链路验收后，移除 `/guide` 对旧 Live2D Haru、旧后端 TTS 播放按钮及相关页面编排的依赖，并补齐 Windows 本地运行与故障处理文档。清理范围只覆盖已被新链路替代且确认无其它页面使用的代码、配置和资源；共享资源若仍有消费者则保留。

文档应让新开发者能够完成环境准备、OpenAvatarChat 模型下载、配置、首次初始化、联合启动、停止和常见故障定位。

## Acceptance criteria

- [ ] `/guide` 不再加载或初始化旧 Live2D 数字人主链路。
- [ ] `/guide` 不再展示旧回答音频按钮、重新播报入口或自动欢迎音频。
- [ ] 删除仅供旧 `/guide` 数字人使用且已无引用的代码、配置和资源。
- [ ] 删除前先确认其它页面和验证脚本的引用；仍有消费者的全局 Haru 或共享资源不被误删。
- [ ] `/guide` 现有聊天布局、文字输入、来源卡和必要游客功能保持可用。
- [ ] Windows 一键联合启动和停止入口覆盖前端、A5 backend 与 avatar service。
- [ ] 本地文档写明两个独立 Python 环境的准备方式，且不要求降低 A5 backend Python 版本。
- [ ] 本地文档写明 OpenAvatarChat/LiteAvatar 模型下载位置、首次初始化、缓存策略和默认人物配置。
- [ ] 本地文档写明必要环境变量或本地配置、端口、启动顺序、健康检查及敏感信息边界。
- [ ] 本地文档包含模型缺失、显存不足、avatar 未连接、麦克风权限失败和端口占用等常见故障处理。
- [ ] 在目标 RTX 4060 Laptop 8GB 环境完成一次联合启动与 `/guide` 文字、语音、打断、断线降级验收，并记录结果。
- [ ] 前端构建、相关 visitor 验证和 A5 backend 回归测试通过；若环境限制无法执行某项，文档中明确记录原因与人工验证方式。

## Blocked by

- [03 文字输入流式回答接入 LiteAvatar 自动播报](./03-streaming-text-to-liteavatar.md)
- [04 麦克风半双工录音、ASR 回填与自动发问](./04-microphone-asr-question-flow.md)
- [05 新问题打断、断线温和重连与不可用降级](./05-interrupt-reconnect-and-degradation.md)
