# 架构与源码接入

## 模块

| 模块 | 实现 |
| --- | --- |
| 游客端、管理端、数字人 | React、TypeScript；原页面与资源 |
| 景点、地图、路线、社区、手账、TTS | FastAPI 业务服务 |
| 知识问答 | GuideCoreRuntime + LangGraph |
| 检索 | Qwen3-Embedding + BM25 + Milvus + RRF + Cross-Encoder |
| 微调 | chunk 种子、教师扩展、检索轨迹、审核分集、Qwen3-8B LoRA |
| 长期记忆 | 授权、静态偏好、动态约束、异步提取、去重、CRUD |
| 评估 | 检索四路对照、RAGAS、LoCoMo |

## 问答流程

```text
React -> /api/chat 或 /api/chat/stream
  -> 身份 / 会话 / 景区校验
  -> 图片、路线操作：业务服务
  -> 知识问答：GuideCoreRuntime
       -> 最近 6 轮对话与已授权偏好
       -> LangGraph decide -> execute -> decide
            search_knowledge -> 混合检索与精排
            read_chunk       -> 读取片段及同章节内容
            finish           -> 回答 / 拒答 / 澄清
       -> 语料版本核对
       -> ChatResponse / 问答日志 / TTS
       -> 记忆提取任务入队
```

数字人人设作为语气和表达偏好进入上下文；景区范围、工具权限和事实来源由服务端控制。

## Graph State

| 字段 | 内容 |
| --- | --- |
| messages | 当前请求的对话与工具观察 |
| scope | 服务端确认的 map_id / spot_id |
| evidence | 已读取 chunk ID 与 Hit |
| rounds / tool_calls | 模型轮数与工具次数 |
| answer / stopped | 结构化答案与终止标记 |
| trace | 动作、参数、执行状态和用量 |
| timings_ms | 检索、模型与总耗时 |

每个请求创建独立状态，节点串行返回状态更新。默认上限为 6 轮模型决策、8 次工具调用；达到预算时保留当前证据和执行记录。Graph 构造参数可注入 checkpointer；跨会话偏好由长期记忆库管理。

## 知识更新

1. `init-data` 导入景点、事实、地图和知识登记。
2. `rebuild` 解析 Markdown、DOCX、文本 PDF、HTML、TXT，并根据景点关联或管理员配置确定景区。
3. 按标题、段落、句子边界分块，默认上限 700 字符、重叠 100 字符；`parent_id` 关联同文档章节。
4. Markdown、HTML、DOCX 表格按“列名: 值”展开；PDF 续表按相邻页、相同锚点、相同表头合并。
5. BM25 通过 jieba 分词；Milvus 使用 HNSW / COSINE。两路按地图及景点过滤，各取 24 个候选，以 `weight / (60 + rank)` 融合；前 20 项精排后取 5 项。
6. 写入不可变快照，构建完成后原子切换发布清单。清单关联 corpus_id、corpus_file、业务修订号与集合名。

PDF 表格锚点文件放在原文件旁，例如 `guide.pdf.tables.json`：

```json
{"2:1":"ticket-policy","3:1":"ticket-policy"}
```

| 管理接口 | 功能 |
| --- | --- |
| POST /api/knowledge/docs | 上传资料，可传 map_id |
| PUT /api/knowledge/docs/{doc_id}/scope | 指定 ling-shan 或 nianhua-bay |
| POST /api/knowledge/rebuild | 解析、建索引、发布 |
| GET /api/knowledge/core-status | 发布版本与配置状态 |
| DELETE /api/knowledge/docs/{doc_id} | 删除资料并更新修订号 |

文档通过显式 map_id 或关联景点确定范围。知识修改推进业务修订号，旧发布版本返回 CORE_INDEX_STALE；导入原文件或上传新版本后执行重建。

## 长期记忆

| 表 | 内容 |
| --- | --- |
| scenic_memory_owner | 用户授权、epoch、写入版本 |
| scenic_memory | 用户、作用域、键值、原句来源、时间、TTL、版本 |
| scenic_memory_job | 事件哈希、源文本、状态、租约与尝试次数 |

静态层保存长期偏好；动态层以已校验的聊天会话为范围，默认 TTL 为 7 天。提取模型读取用户陈述，输出白名单字段与原文引句；规范化键和值后，同一槽位按时间更新。

`GET/PUT /api/memory/consent` 管理授权；`GET /api/memory` 读取静态层，附加 session_id 读取对应动态层；`PUT /api/memory` 编辑，`DELETE /api/memory/{id}` 删除。

授权撤回清空记忆及任务源文本。epoch 校验阻止旧任务覆盖当前数据，编辑采用乐观版本检查。HTTP 请求负责入队，独立 worker 负责提取和去重。过期租约进入 uncertain 状态，保留操作记录供核对。

## 服务协议

ChatResponse 保留原回答、引用、TTS、模式与耗时字段。SSE 使用独立数据库会话，按 status/delta/final 事件发送完整推理结果的文本分片。后端耗时覆盖检索、推理与语音任务提交；浏览器负责数字人渲染。

发布锁协调同目录中的跨进程重建，进程内信号量管理本地推理容量。
