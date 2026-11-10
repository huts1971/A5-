# 灵诗音核心

可独立安装的 Agentic RAG、SFT 与长期记忆 Python 包。整站配置和启动见 [项目 README](../../README.md)。

## 功能

| 模块 | 入口 |
| --- | --- |
| 官网抓取、结构分块、跨页表格 | crawl.py / ingestion.py |
| Qwen3-Embedding、BM25、Milvus、RRF、Cross-Encoder | models.py / retrieval.py |
| LangGraph 检索、补读、结构化作答 | agent.py |
| 静态/动态记忆、异步提取、去重、CRUD | memory.py |
| chunk 种子、逐查询检索轨迹、LoRA/QLoRA | sft.py |
| 检索对照、RAGAS、LoCoMo | evaluation.py / locomo.py |
| 原业务数据与聊天协议适配 | integration.py |

## 安装

Python 3.11 或 3.12，在当前包目录执行：

```powershell
python -m pip install -e ".[ingest,retrieval]"
```

训练使用 `[train]`，NF4 量化使用 `[quant]`，评测使用 `[eval]`，MySQL 使用 `[mysql]`。

复制 `configs/core.example.toml` 为 `configs/core.local.toml`，配置本地权重、revision、Milvus 和问答服务，启用 `allow_network`。配置内路径相对于 TOML；命令参数路径相对于终端目录。

## 独立语料

```powershell
scenic-core --config configs/core.local.toml ingest guide.pdf artifacts/guide.jsonl --document-id guide-v1 --title 游客指南 --map-id ling-shan --table-anchors configs/table-anchors.example.json --approved
scenic-core --config configs/core.local.toml merge artifacts/corpus.jsonl artifacts/guide.jsonl
scenic-core --config configs/core.local.toml --execute index
scenic-core --config configs/core.local.toml --execute ask "灵山大佛有哪些建筑特点？" --map-id ling-shan --output artifacts/answer.jsonl
```

分块保留来源、页码、景区与父章节。不同语料和 embedding 版本使用独立 Milvus 集合；构建过程通过文件锁、主键 upsert 和 ready 清单管理。问答使用工具白名单、引用检查及轮数预算。

完整项目的知识发布入口为 backend 目录下的 `python -m app.core_cli rebuild`，发布指针关联业务修订号和不可变语料。

## 数据与训练

```powershell
scenic-core --config configs/core.local.toml sft-seeds artifacts/seeds.jsonl --limit 200
scenic-core --config configs/core.local.toml --execute sft-expand artifacts/seeds.jsonl artifacts/candidates.jsonl --max-calls 10
scenic-core --config configs/core.local.toml sft-export artifacts/reviewed-training.jsonl artifacts/sft
scenic-core --config configs/core.local.toml --execute train configs/sft.example.toml
```

审核候选后写入 `reviewed-training.jsonl`，填写 reviewer 并设置 approved=true。导出按文档划分训练、开发和留出集。工具观察来自逐查询混合检索，保留对应来源与语料版本；训练只对 assistant token 计算损失。

## 记忆与评测

```powershell
scenic-core --config configs/core.local.toml memory-init
scenic-core --config configs/core.local.toml --execute memory-worker-once
scenic-core --config configs/core.local.toml --execute eval-retrieval artifacts/retrieval-gold.jsonl artifacts/retrieval-results.jsonl
scenic-core --config configs/judge.local.toml --execute eval-ragas artifacts/predictions.jsonl artifacts/ragas-results.jsonl --max-samples 100
```

记忆表按用户、作用域和版本隔离；异步 worker 执行提取、原句校验和槽位去重。

详细说明：[训练与评估](../../docs/training-evaluation.md) · [业务接入](docs/对接原项目.md)。
