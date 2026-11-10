# 阿里百炼 text-embedding-v4 接入说明

本文配置用于 `GUIDE_ENGINE=legacy` 的 OpenAI-compatible `/embeddings` 链路。默认 Agentic RAG 使用 Qwen3-Embedding 和 Milvus，配置见 [部署说明](deployment.md)。

## 本地配置

在 `backend/.env` 中配置：

```env
GUIDE_ENGINE=legacy
LLM_MODE=openai_compatible
LLM_PROVIDER=mimo
LLM_BASE_URL=https://api.xiaomimimo.com/v1
LLM_API_KEY=你的MiMo API Key
LLM_MODEL=mimo-v2.5

RAG_RETRIEVAL_MODE=hybrid
RAG_VECTOR_MODE=openai_compatible
RAG_EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
RAG_EMBEDDING_API_KEY=你的阿里百炼APIKey
RAG_EMBEDDING_MODEL=text-embedding-v4
RAG_EMBEDDING_TIMEOUT_SECONDS=0.8

GUIDE_STYLE=warm_real_guide
GUIDE_ROUTE_TRIGGER_STRICT=true
```

也可以使用别名：

```env
DASHSCOPE_API_KEY=你的阿里百炼APIKey
```

真实 API Key 只允许放在本地 `backend/.env`、系统环境变量或部署平台密钥配置中。不要提交到 Git。

## 与 MiMo 的关系

MiMo 继续负责：

- AI 导游回答生成
- TTS 语音合成
- 联网补充能力

阿里百炼 `text-embedding-v4` 只负责：

- 给知识库片段生成向量
- 给用户问题生成一次查询向量
- 辅助召回“哪里出片、建筑感强、适合老人慢慢逛”等模糊表达

## 降级策略

- 没有 key：向量检索关闭，系统继续使用结构化事实 + FTS/BM25。
- 请求超时：静默跳过向量检索。
- 请求失败：静默跳过向量检索。
- 明确事实问题：结构化事实优先，不被 embedding 覆盖。

## 真实质感评测

比赛展示前可以跑一轮真实 MiMo + 百炼 embedding 评测：

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\evaluate_guide_real_quality.py --allow-external
```

这条命令把测试问题、检索证据和导游 prompt 发送到 `.env` 配置的模型 API。输出报告保存在本地运行目录，包含回答、引用和耗时。

## 上传 Git 的规则

可以提交：

- `backend/.env.example`
- embedding 客户端代码
- RAG 检索逻辑
- 本说明文档

不要提交：

- `backend/.env`
- 任何真实 API Key
- 本地数据库、缓存、日志
