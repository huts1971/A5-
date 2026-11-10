# A5 AI 导游：本地运行

完整项目的配置与启动步骤已统一到 [README.md](README.md)。本文件保留为比赛版文档入口。

- 首次安装：Python 3.11/3.12、Node.js 20+，创建 `backend/.venv`，执行 `scripts/configure-local.py`。
- 后端依赖：在 `backend` 目录安装 `requirements-agentic.txt`。
- 核心配置：`configs/core.local.toml`；业务配置：`backend/.env`。
- Agentic 问答：准备本地模型、启动 Milvus、执行 `app.core_cli init-data` 与 `rebuild`。
- 开发模式：后端 `uvicorn`，前端 `npm run dev`。
- 静态模式：`BUILD-FRONTEND.bat` 后运行 `START-HERE.bat`，停止使用 `stop-local.bat`。

一键脚本不会自动下载模型、训练 LoRA 或构建 Milvus 索引。没有配置模型时，页面与规则路线可单独启动；Agentic 问答会返回明确的配置错误。旧问答可通过 `GUIDE_ENGINE=legacy` 显式启用。

模型服务、Linux/WSL2、可选语音与地图配置详见 [部署说明](docs/deployment.md)。
