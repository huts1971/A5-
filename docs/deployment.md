# 部署与配置

## 配置文件

| 文件 | 内容 |
| --- | --- |
| `backend/.env` | 业务数据库、鉴权、语音、图片、地图；GUIDE_ENGINE 默认 agentic |
| `configs/core.local.toml` | 模型目录及版本、Milvus、问答服务、记忆数据库、调用预算 |
| `frontend/.env.local` | 前端 API 与地图配置 |
| `configs/sft.example.toml` | LoRA 训练配方 |

`python scripts/configure-local.py` 生成缺失配置及随机管理员密码、签名密钥，保留已有文件。TOML 文件路径相对于配置所在目录；CLI 输入输出路径相对于终端当前目录。

`embedding_revision`、`reranker_revision` 填写权重提交版本或校验标识；模型从本地目录加载。`allow_network=true` 开启核心的模型服务、Milvus 和远程记忆连接。独立 CLI 的网络及训练命令通过 `--execute` 启用。

## Qwen3 模型服务

在独立 Linux/WSL2 CUDA 环境安装 vLLM，准备 `/models/Qwen3-8B`：

```bash
vllm serve /models/Qwen3-8B \
  --host 127.0.0.1 --port 8002 \
  --served-model-name Qwen3-8B \
  --enable-auto-tool-choice --tool-call-parser hermes \
  --max-model-len 16384
```

核心配置为 `chat_base_url="http://127.0.0.1:8002/v1"`、`chat_model="Qwen3-8B"`、`chat_template_kwargs={enable_thinking=false}`。模型端点提供工具调用和 JSON Schema 输出；业务后端使用端口 8001。

远程服务通过 HTTPS 与 `SCENIC_LLM_API_KEY` 鉴权，也可通过 SSH 端口转发接入本机回环地址。

加载 LoRA 时增加：

```bash
--enable-lora --max-lora-rank 16 \
--lora-modules scenic-guide=/artifacts/qwen3-8b-scenic-lora/adapter
```

将核心 `chat_model` 切换为 `scenic-guide`。服务加载与训练一致的基座版本；`max-lora-rank` 覆盖配方中的 rank。

参考：[Qwen 工具调用](https://qwen.readthedocs.io/en/latest/framework/function_call.html)、[vLLM LoRA](https://docs.vllm.ai/en/latest/features/lora/)。

## 检索与索引

本地检索权重为 [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) 和 [bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3)。`models.device` 支持 CPU 或 CUDA。

```powershell
docker compose -f infra/compose.yaml up -d
cd backend
python -m app.core_cli init-data
python -m app.core_cli rebuild
```

Compose 提供 Milvus、etcd、MinIO，Milvus 端口绑定本机回环。数据保存在命名卷中；`docker compose -f infra/compose.yaml down` 停止服务并保留卷。

重建流程写入版本化语料、构建 Milvus 集合，再原子切换 `corpus.release.jsonl`。同一文件目录下的构建使用跨进程文件锁；中断集合通过 upsert 重建，并在条数核对后发布 ready 清单。问答读取发布指针指定的快照。

完整项目通过 `app.core_cli rebuild` 维护业务修订号；`scenic-core index` 用于独立语料索引。

## 长期记忆

游客使用登录 Bearer token 调用 `PUT /api/memory/consent`，请求体为 `{"enabled":true}`。在 backend 目录启动异步处理：

```powershell
python -m app.core_cli memory-worker
```

`--once` 处理一个任务，`--max-jobs N` 设置任务数。SQLite 默认路径为 `backend/data/guide-memory.db`；MySQL 使用 `mysql+pymysql://...`，并安装核心 `[mysql]` extra。

`app.core_cli` 加载后端 .env；独立 `scenic-core` 从进程环境读取 `SCENIC_LLM_API_KEY` 与 `SCENIC_MILVUS_TOKEN`。

## 业务服务

- 高德、语音、图片识别、MiMo、Seedream、Kimi 使用 `backend/.env.example` 的独立配置。
- `GUIDE_ENGINE=agentic` 使用新问答核心，`legacy` 使用原业务问答。
- 本地 Web 服务使用单进程，核心推理容量为一个请求；忙时返回 429。
- 前端开发执行 `npm run dev`；静态部署先执行 `BUILD-FRONTEND.bat`，再执行 `START-HERE.bat`。
- Linux/macOS 使用 `python3.11 -m venv backend/.venv` 和 `source backend/.venv/bin/activate`。

## 错误处理

| 错误 | 操作 |
| --- | --- |
| CORE_NOT_CONFIGURED | 生成配置并检查 GUIDE_CORE_CONFIG |
| CORE_NETWORK_DISABLED | 配置服务后启用 allow_network |
| CORE_INDEX_MISSING / CORE_INDEX_STALE | 执行 init-data / rebuild |
| CORE_SOURCE_CHANGED | 重新导入原始资料后重建 |
| CORE_BUSY | 当前操作结束后再次提交 |
| CORE_UNAVAILABLE | 根据后端日志检查模型、索引和响应格式 |
| 模型目录或 revision 错误 | 配置完整权重路径及其版本 |

