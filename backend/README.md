# 灵诗音后端

FastAPI 业务服务与 Agentic RAG 接入层。完整配置见 [根目录 README](../README.md)。

## 本地启动

先在根目录创建并激活 Python 3.11/3.12 环境，执行 `scripts/configure-local.py`，配置模型与 Milvus，再从本目录执行：

```powershell
python -m pip install -r requirements-agentic.txt
python -m app.core_cli init-data
python -m app.core_cli rebuild
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

接口文档：http://127.0.0.1:8001/docs 。管理员初始密码在本地 `.env` 中随机生成。

## 核心入口

- `app/services/agentic_runtime.py`：索引发布、景区隔离、问答适配、日志与记忆入队。
- `app/api/chat.py`：原问答/SSE 接口及会话归属校验。
- `app/api/knowledge.py`：管理员上传、范围绑定、删除、重建。
- `app/api/memory.py`：登录用户的授权与记忆管理。
- `python -m app.core_cli memory-worker`：异步提取记忆。
- `python -m app.core_cli status`：查看发布状态，不调用模型。

`GUIDE_ENGINE=agentic` 为默认主链；显式设为 `legacy` 才使用旧检索与降级问答。图片识别、路线、语音、手账和社区服务保留。

[架构](../docs/architecture.md) · [部署](../docs/deployment.md) · [训练评估](../docs/training-evaluation.md) · [发布说明](../docs/release-review.md)
