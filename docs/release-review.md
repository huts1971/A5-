# 发布与产物管理

## 项目组成

游客端、管理端和数字人资源来自比赛项目，问答核心位于 `packages/scenic-guide-core`。后端通过 `GuideCoreRuntime` 接入检索、Agent、记忆和评估入口。

功能说明见 [架构文档](architecture.md)，部署步骤见 [README](../README.md)。

## 产物目录

| 目录 | 内容 |
| --- | --- |
| models/ | 基座、Embedding、Cross-Encoder 权重 |
| artifacts/core/ | 语料快照、索引清单、发布指针 |
| artifacts/sft/ | train/dev/test 与数据清单 |
| artifacts/qwen3-8b-scenic-lora/ | adapter、tokenizer、训练状态与指标 |
| backend/data/ | 业务库、记忆库、上传文件、日志 |
| frontend/dist/ | 前端静态构建 |
| configs/*.local.toml | 部署者本地配置 |

这些运行与模型产物由 .gitignore 管理，配置模板保留在仓库中。原始景区知识、地图配置、前端页面与必要数字人资源随源码管理。

## 提交

```powershell
git init -b main
git add .
git status --short
git diff --cached --stat
git commit -m "Integrate scenic guide with Agentic RAG, SFT and memory"
```

提交清单保留源码、文档、配置模板和授权资源。凭证使用本地环境或密钥系统，游客数据保存在运行目录。第三方资源遵循 [资源来源与许可](../THIRD_PARTY_NOTICES.md)。

## 打包

`MAKE-PORTABLE-PACKAGE.bat` 调用打包脚本整理发布目录，收集源码、示例配置、知识资料与静态资源。运行目录、模型、私有配置及开发环境由忽略规则排除。安装和启动使用根 README。
