# 灵诗音 · 多模态 AI 虚拟人智能导览系统

面向灵山胜境、拈花湾的景区知识问答、个性化路线与数字人导览平台。

**技术栈：** React / TypeScript / Vite / Ant Design · FastAPI / SQLAlchemy · LangGraph · Qwen3-Embedding / BM25 / Milvus / RRF / Cross-Encoder · PEFT / RAGAS。

## 环境要求

- Python 3.11 或 3.12、Node.js 20+、Docker Compose。
- 本地准备 Qwen3-Embedding-0.6B、bge-reranker-v2-m3；问答使用支持工具调用与 JSON Schema 的 Qwen3-8B 服务。
- 模型服务和训练环境见 [部署说明](docs/deployment.md)。不需要重新编译 Unity 数字人资源。

## 首次配置

以下 PowerShell 命令从项目根目录执行。项目可以整体移动，不要复制其他电脑的虚拟环境。

```powershell
py -3.11 -m venv backend/.venv
./backend/.venv/Scripts/Activate.ps1
python scripts/configure-local.py
cd backend
python -m pip install -r requirements-agentic.txt
cd ../frontend
npm ci
cd ..
```

编辑 `configs/core.local.toml`：填写本地模型目录、实际权重版本、问答服务地址，并在准备好服务后将 `allow_network` 改为 `true`。路径以 TOML 所在目录为基准。

`backend/.env` 保存数据库与可选模型服务配置。管理员用户名默认为 `admin`，随机初始密码在该文件的 `ADMIN_DEFAULT_PASSWORD` 中。已有配置不会被覆盖。

## 初始化知识索引

先启动 [Qwen3 服务](docs/deployment.md#qwen3-模型服务)，再执行：

```powershell
docker compose -f infra/compose.yaml up -d
cd backend
python -m app.core_cli init-data
python -m app.core_cli rebuild
cd ..
```

管理端上传知识后，指定景区范围并点击重建索引。导入范围、表格锚点及管理接口见 [架构说明](docs/architecture.md#知识更新)。

## 启动项目

终端一，项目根目录：

```powershell
./backend/.venv/Scripts/Activate.ps1
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

终端二，项目根目录：

```powershell
cd frontend
npm run dev
```

| 入口 | 地址 |
| --- | --- |
| 游客端 / 数字人导游 | http://127.0.0.1:5173/guide |
| 管理端 | http://127.0.0.1:5174/ |
| 后端接口文档 | http://127.0.0.1:8001/docs |

长期记忆通过登录用户的 `/api/memory/consent` 授权。另开已激活虚拟环境的终端，在 `backend` 下运行 `python -m app.core_cli memory-worker` 处理提取任务。

需要静态运行时，先运行 `BUILD-FRONTEND.bat`，再运行 `START-HERE.bat`；关闭使用 `stop-local.bat`。模型服务与 Milvus 单独管理。

## 目录

```text
backend/                   FastAPI 业务、管理接口与核心适配层
frontend/                  游客端、管理端、数字人及地图资源
packages/scenic-guide-core/ 检索、Agent、记忆、微调、评估
knowledge/                 景区知识、地图与路线配置
configs/                   核心与微调配置模板
infra/                     本地 Milvus Compose
docs/                      架构、部署、训练评估与发布说明
```

详细资料：[架构与接入](docs/architecture.md) · [部署与配置](docs/deployment.md) · [训练与评估](docs/training-evaluation.md) · [代码审视](docs/code-review.md) · [指标记录](docs/results.md) · [发布说明](docs/release-review.md) · [资源来源](THIRD_PARTY_NOTICES.md)。
