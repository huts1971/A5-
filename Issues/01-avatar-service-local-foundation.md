# 建立 avatar service 本地骨架与联合启动基础

类型：AFK

状态：已完成（2026-06-28）

覆盖用户故事：22、25、26、27、28、36

## What to build

在不改变 A5 backend 运行环境和问答接口的前提下，建立独立运行的本地 avatar service。该服务复用 OpenAvatarChat 的 TTS 与 LiteAvatar 能力，通过最小 A5 适配层暴露健康检查和基础会话能力，并纳入 Windows 一键联合启动流程，使开发者能够在同一台电脑上启动前端、A5 backend 与 avatar service。

首版只服务本地单机、单会话演示。OpenAvatarChat 与模型依赖使用独立虚拟环境和本地配置，不将密钥、机器路径或模型缓存写死到仓库。

## Acceptance criteria

- [ ] avatar service 可在独立于 A5 backend 的 Python 虚拟环境中安装和启动。
- [ ] A5 backend 的现有环境、启动方式与聊天接口无需降级或迁移。
- [ ] avatar service 提供可供前端判断服务存活和初始化状态的健康检查。
- [ ] 服务可加载 OpenAvatarChat TTS 与 LiteAvatar 默认人物所需配置，并对模型未下载、配置缺失和初始化失败给出可定位的错误。
- [ ] 本地配置支持通过环境变量或不含敏感信息的配置文件指定端口、模型目录和必要参数。
- [ ] Windows 联合启动入口可以启动前端、A5 backend 与 avatar service，且重复执行时不会静默创建无法辨认的重复服务。
- [ ] avatar service 未启动时，A5 backend 和现有文字问答仍可独立启动和使用。
- [ ] 提供最小自动化或命令级验证，证明健康检查成功、失败状态明确且 A5 backend 未被 avatar 依赖污染。

## Blocked by

None - can start immediately
