# 微调与评估

## 数据构建

在项目根目录激活 Python 环境，按 README 完成知识索引发布。

```powershell
scenic-core --config configs/core.local.toml sft-seeds artifacts/seeds.jsonl --limit 200
scenic-core --config configs/core.local.toml --execute sft-expand artifacts/seeds.jsonl artifacts/candidates.jsonl --max-calls 10
```

`sft-seeds` 按来源文档提取核心 chunk 组；教师模型扩展单跳、多跳、拒答边界和日常对话四类候选。单跳题携带来源，多跳题至少包含两个证据块和两个子查询。

`sft-expand` 对每个子查询调用混合检索器，记录对应的工具观察、语料版本和教师用量。观察格式与线上 `search_knowledge` 共用实现；所有答案引用都须出现在观察中。检索结果按文档分集过滤，保持训练、开发和留出数据的来源隔离。

审核问题、事实引用、拒答条件及多跳依赖，在候选记录中填写 `reviewer` 并将 `approved` 设为 `true`，然后导出：

```powershell
scenic-core --config configs/core.local.toml sft-export artifacts/candidates.jsonl artifacts/sft
```

输出为 `train.jsonl`、`dev.jsonl`、`test.jsonl` 和样本清单。文档 ID 的固定哈希按 80/10/10 分区；导出执行来源分区与重复问题检查。训练要求 train、dev 均包含样本。

## LoRA 训练

CUDA 环境准备本地 Qwen3-8B 权重，编辑 `configs/sft.example.toml` 中的模型、数据和输出目录。

```powershell
python -m pip install -e "packages/scenic-guide-core[train]"
scenic-core --config configs/core.local.toml --execute train configs/sft.example.toml
```

| 参数 | 配置 |
| --- | --- |
| 训练框架 | Transformers Trainer + PEFT |
| 目标层 | all-linear |
| rank / alpha | 16 / 32 |
| 序列长度 | 4096 tokens |
| 单卡 batch / 梯度累积 | 1 / 16 |
| 学习率 / 轮数 | 1e-4 / 3 |
| 调度 | cosine、5% warmup |
| 精度 | GPU 支持 BF16 时使用 BF16，否则 FP16 |
| 显存管理 | 梯度检查点 |
| 损失 | assistant token，包括工具调用 |

Qwen chat template 使用 non-thinking 模式，用户消息及工具观察对应的 labels 为 -100。超长样本在编码时返回长度错误。安装 `[quant]` 并设置 `qlora=true` 可使用 NF4 4-bit 基座训练。

输出目录保存 `adapter/`、tokenizer、训练检查点、Trainer 状态、train/eval 指标和 `training-manifest.jsonl`。清单包含配方、数据 SHA-256、样本数量和基座路径。适配器服务步骤见 [部署说明](deployment.md#qwen3-模型服务)。

## 检索评估

标注 JSONL 每行字段：

| 字段 | 内容 |
| --- | --- |
| id / question | 题目 ID 和游客问题 |
| scope | map_id，以及可选 spot_id |
| corpus_id | 发布语料指纹 |
| relevant_chunk_ids | 人工标注的相关 chunk ID 列表 |

```powershell
scenic-core --config configs/core.local.toml --execute eval-retrieval data/retrieval-gold.jsonl artifacts/retrieval-results.jsonl
```

同一问题集比较 BM25、vector、hybrid、hybrid_rerank 四种模式。输出逐题结果及 `.summary.jsonl` 汇总。

| 指标 | 口径 |
| --- | --- |
| Recall@5 | 前五项相关 chunk 数 / 标注相关 chunk 总数，逐题宏平均 |
| Hit@5 | 前五项至少包含一个相关 chunk 的题目比例 |
| MRR@5 | 第一项相关结果的排名倒数，逐题平均 |
| nDCG@5 | 前五项二值相关性的位置折扣收益，相对理想排序归一化 |

检索异常计零分并记录错误；数据集保持固定语料版本和正相关标注。

## 回答与 RAGAS

```powershell
python -m pip install -e "packages/scenic-guide-core[eval]"
scenic-core --config configs/core.local.toml --execute generate-predictions data/qa-heldout.jsonl artifacts/predictions.jsonl --max-samples 20
scenic-core --config configs/judge.local.toml --execute eval-ragas artifacts/predictions.jsonl artifacts/ragas-results.jsonl --max-samples 100
```

`judge.local.toml` 使用核心配置格式，设置裁判模型地址、模型名与本地 embedding。题目输入包含 `id/question/scope`；生成记录保存回答、读取上下文、状态、trace 和耗时。`--max-samples` 控制单批样本上限。

- **Faithfulness**：回答中的事实陈述获得检索上下文支持的程度。
- **Answer Relevancy**：回答与输入问题的语义相关程度；使用 RAGAS 的 `ResponseRelevancy`。
- 汇总包含有效项均值、有效数、失败数、总数和上游生成失败数。
- 基座与 LoRA 对照使用相同留出题、语料、检索配置和裁判配置。

## LoCoMo 记忆评估

`EpisodicMemoryPlugin` 将对话中的人物、事件、时间与原句证据存入独立评测命名空间，通过 BM25、Embedding 和 RRF 检索相关记忆并生成答案。

```powershell
scenic-core --config configs/locomo.local.toml --execute locomo-run data/locomo.json artifacts/locomo-predictions.jsonl --run-id locomo-v1 --max-samples 10 --max-questions 2000 --max-calls 200
scenic-core --config configs/locomo.local.toml locomo-score data/locomo.json artifacts/locomo-predictions.jsonl artifacts/locomo-scores.jsonl
```

配置使用独立记忆数据库。`run-id` 标识实验命名空间，`max-calls` 控制抽取与回答的模型请求总预算。评分读取完整基准中的 Single Hop 与 Multi Hop 题目，缺失预测按零分计入，并记录覆盖情况。

Single Hop 对规范化后的答案计算 token F1；Multi Hop 对参考子答案分别匹配预测子答案的最佳 F1 后求平均。汇总以 0–100 表示。

## 结果

实验结果表见 [指标记录](results.md)。每组输出关联数据版本、语料指纹、模型版本、预算、样本数及失败数。

参考：[PEFT LoRA](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora)、[RAGAS 指标](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)、[LoCoMo](https://github.com/snap-research/locomo)。
