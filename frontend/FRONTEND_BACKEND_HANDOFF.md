# 前端交付与后端集成说明

项目：中软杯 A5 景区导览服务 AI 数字人 P0  
前端负责人范围：游客端、管理后台、AI 数字人体验、前端 API 封装  
当前状态：P0 基础版已完成，可用 mock 数据完整演示，等待后端逐步接入真实接口。

接手提示：新一轮交接请先读根目录 `AGENTS.md` 和前端 `AGENTS.md`，
再读 `CONTEXT.md`。涉及提交、分支、生成文件、密钥和验收检查时，必须同步读
`../git-instruction.md`，不要只看本文件判断 Git 操作。

## 1. 当前已完成内容

### 游客端

访问地址：

```text
http://127.0.0.1:5173/
```

已完成页面：

- 首页 `/`
- 景点列表 `/spots`
- 景点详情 `/spots/:spotId`
- 路线推荐 `/routes`
- AI 数字人导游 `/guide`

游客端能力：

- 首页展示系统定位、热门景点、推荐路线、AI 导游入口。
- 景点列表和详情页展示景点基础资料、标签、适合人群、讲解内容。
- 路线推荐页支持游客类型、游玩时间、步行强度、兴趣标签。
- AI 导游页支持文字问答、loading、来源卡片、浏览器语音播报、失败兜底。
- 数字人头像支持 `idle / thinking / speaking` 三种状态。

### 管理后台

访问地址：

```text
http://127.0.0.1:5174/
```

已完成页面：

- 数据看板 `/dashboard`
- 景点管理 `/spots`
- 路线管理 `/routes`
- 知识库管理 `/knowledge`
- 问答日志 `/logs`

后台能力：

- 景点管理：Table + Modal Form，本地 mock CRUD。
- 路线管理：Table + Modal Form，本地 mock CRUD。
- 知识库管理：文档列表、新增/编辑/删除、重建索引按钮。
- 问答日志：展示问题、回答、来源、时间，支持关键词搜索。

## 2. 运行方式

进入前端目录：

```bash
cd "D:\codex files\中软杯\frontend"
```

安装依赖：

```bash
npm.cmd install
```

启动开发服务：

```bash
npm.cmd run dev
```

默认地址：

```text
http://127.0.0.1:5173/
```

如果希望同一局域网队友访问：

```bash
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

然后让队友访问：

```text
http://你的局域网IP:5173/
http://你的局域网IP:5174/
```

## 3. Mock 模式与真实后端切换

当前默认使用 mock 模式，不依赖后端即可演示。

前端配置文件：

```text
src/api/config.ts
```

默认逻辑：

```ts
export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== 'false';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
```

切换真实后端时，在 `frontend/.env.local` 中配置：

```env
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=http://127.0.0.1:8000
```

说明：

- `VITE_USE_MOCK_API=false`：关闭 mock，走真实后端。
- `VITE_API_BASE_URL`：后端服务地址。
- 如果前后端同域部署，可以留空 `VITE_API_BASE_URL`，请求会走相对路径。

## 4. 前端 API 封装位置

所有真实请求统一经过：

```text
src/api/client.ts
```

页面不直接调用 `fetch` 或 `axios`。

业务 API 文件：

```text
src/api/spots.ts       景点接口
src/api/routes.ts      路线推荐接口
src/api/chat.ts        AI 导游问答接口
src/api/logs.ts        问答日志接口
src/api/knowledge.ts   知识库接口
src/api/index.ts       统一导出
```

后端同学主要对齐这些函数即可：

```ts
getSpots()
getSpotDetail(spotId)
recommendRoutes(input)
chatWithGuide(input)
getChatLogs(query)
rebuildKnowledgeIndex()
```

## 5. 后端需要提供的接口

### 5.1 获取景点列表

```http
GET /api/spots
```

返回：

```ts
ScenicSpot[]
```

字段：

```ts
interface ScenicSpot {
  id: string;
  name: string;
  subtitle: string;
  summary: string;
  story: string;
  tags: string[];
  crowdTypes: string[];
  durationMinutes: number;
  openInfo: string;
  serviceHint: string;
  coverTone: 'water' | 'culture' | 'garden' | 'service';
  highlights: string[];
}
```

### 5.2 获取景点详情

```http
GET /api/spots/:spotId
```

返回：

```ts
ScenicSpot
```

### 5.3 路线推荐

```http
POST /api/routes/recommend
```

请求：

```ts
interface RoutePreferenceInput {
  visitorType: 'family' | 'culture' | 'relax' | 'photo';
  durationMinutes: number;
  physicalLevel: 'low' | 'medium' | 'high';
  interestTags: string[];
}
```

返回：

```ts
RoutePlan[]
```

字段：

```ts
interface RoutePlan {
  id: string;
  name: string;
  theme: string;
  durationMinutes: number;
  suitableCrowd: string[];
  description: string;
  reason: string;
  spots: RouteSpot[];
}

interface RouteSpot {
  spotId: string;
  name: string;
  stayMinutes: number;
  reason: string;
}
```

### 5.4 AI 导游问答

```http
POST /api/chat
```

请求：

```ts
interface ChatRequest {
  question: string;
  sessionId?: string;
  visitorType?: 'family' | 'culture' | 'relax' | 'photo';
  currentSpotName?: string;
}
```

返回：

```ts
interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  audioUrl?: string;
  sessionId?: string;
  isFallback?: boolean;
  error?: ApiError;
}

interface ChatSource {
  id: string;
  title: string;
  spotName: string;
  snippet: string;
}
```

要求：

- `answer` 是最终展示给游客的回答。
- `sources` 建议返回 1-3 个来源，前端会展示为来源卡片。
- `sessionId` 用于多轮会话续接。
- `audioUrl` 可选。P0 前端已支持浏览器 `SpeechSynthesis`，所以后端暂时不提供音频也能演示。
- 如果 RAG 没检索到资料，建议后端返回稳妥答复，不要编造。

### 5.5 问答日志

```http
GET /api/logs/chats?keyword=xxx&limit=50
```

返回：

```ts
ChatLogItem[]
```

字段：

```ts
interface ChatLogItem {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  sources: Array<{
    title: string;
    spotName: string;
  }>;
  visitorType?: string;
  createdAt: string;
}
```

后台展示字段：

- 问题
- 回答
- 来源
- 时间
- 游客类型

### 5.6 重建知识库索引

```http
POST /api/knowledge/rebuild
```

返回：

```ts
interface KnowledgeRebuildResult {
  status: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
  indexedDocs?: number;
  indexedChunks?: number;
  startedAt?: string;
}
```

说明：

- P0 可以同步返回 `completed`。
- 如果后端异步重建，也可以先返回 `queued`，后续再扩展状态查询接口。

## 6. 统一错误结构

前端会把非 2xx 响应统一转成：

```ts
interface ApiError {
  message: string;
  status?: number;
  code?: string;
  detail?: unknown;
}
```

建议后端错误响应也尽量使用：

```json
{
  "message": "知识库索引未构建，请先重建索引",
  "code": "KNOWLEDGE_INDEX_NOT_READY",
  "detail": {}
}
```

AI 问答比较特殊：  
`chatWithGuide` 已经做了前端兜底。即使 `/api/chat` 失败，页面也不会白屏，会展示“本地兜底回答”。

## 7. 联调建议步骤

### 第一步：先保持 mock，确认前端正常

```bash
npm.cmd run dev
```

打开：

```text
http://127.0.0.1:5173/
http://127.0.0.1:5174/
```

### 第二步：后端先实现最小接口

建议按这个顺序实现：

1. `GET /api/spots`
2. `GET /api/spots/:spotId`
3. `POST /api/routes/recommend`
4. `POST /api/chat`
5. `GET /api/logs/chats`
6. `POST /api/knowledge/rebuild`

原因：

- 景点和路线最容易先联通。
- `/api/chat` 涉及 RAG/LLM，可以稍后接。
- 日志和知识库属于后台增强，但 P0 后台需要看起来完整。

### 第三步：切换真实接口

创建 `frontend/.env.local`：

```env
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=http://127.0.0.1:8000
```

重启前端：

```bash
npm.cmd run dev
```

### 第四步：逐页验证

游客端：

- `/` 首页是否能加载景点和路线。
- `/spots` 景点列表是否正常。
- `/spots/:spotId` 景点详情是否正常。
- `/routes` 路线推荐是否返回合理结果。
- `/guide` AI 问答是否返回回答和来源。

后台：

- 管理端口 `5174` 的 `/spots` 景点管理是否能展示真实数据。
- 管理端口 `5174` 的 `/routes` 路线管理是否能展示路线数据。
- 管理端口 `5174` 的 `/knowledge` 重建索引按钮是否可用。
- 管理端口 `5174` 的 `/logs` 是否能看到问答日志。

## 8. 自动验证命令

构建验证：

```bash
npm.cmd run build
```

游客端自动验证：

```bash
npm.cmd run verify:visitor
```

后台自动验证：

```bash
npm.cmd run verify:admin
```

截图输出：

```text
frontend/test-results/visitor-flow
frontend/test-results/admin-flow
```

注意：

- 当前 Playwright 浏览器缓存放在 `D:\codex files\中软杯\.cache\ms-playwright`。
- 如果换电脑，需要重新执行依赖安装和 Playwright 浏览器安装。

## 9. 当前仍是 mock 的部分

这些功能目前只做了前端演示，不会持久化到后端：

- 后台景点新增/编辑/删除。
- 后台路线新增/编辑/删除。
- 后台知识库文档新增/编辑/删除。

这些 CRUD 当前是页面本地 state，用来保证 P0 后台演示完整。  
如果后端准备接 CRUD，需要后续补接口：

```http
POST /api/spots
PUT /api/spots/:spotId
DELETE /api/spots/:spotId

POST /api/routes
PUT /api/routes/:routeId
DELETE /api/routes/:routeId

GET /api/knowledge/docs
POST /api/knowledge/docs
PUT /api/knowledge/docs/:docId
DELETE /api/knowledge/docs/:docId
```

P0 当前最关键的是先接通列表、详情、推荐、问答、日志和重建索引。

## 10. CORS 与部署注意事项

如果前端是：

```text
http://127.0.0.1:5173
```

后端是：

```text
http://127.0.0.1:8000
```

后端需要允许 CORS：

```text
Origin: http://127.0.0.1:5173
```

如果使用 FastAPI，可参考：

```py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

生产部署时建议：

- 前端打包后由 Nginx 或静态服务托管。
- 后端统一提供 `/api/...`。
- 前端 `VITE_API_BASE_URL` 可以留空，走同域 `/api`。

## 11. 已知提示与风险

- Windows PowerShell 可能出现 `profile.ps1` 执行策略提示，不影响运行。
- `npm` 在 PowerShell 中可能被策略拦截，建议用 `npm.cmd`。
- 当前构建有 Ant Design bundle size 警告，不影响 P0；后续可做路由懒加载优化。
- 当前景区数据是演示数据，需要替换为最终选定景区真实资料。
- 当前数字人头像是 CSS 轻量形象，后续可替换为正式 2D 导游图。

## 12. 交付清单

前端核心代码：

```text
src/App.tsx
src/layouts/VisitorLayout.tsx
src/layouts/AdminLayout.tsx
src/pages/visitor/*
src/pages/admin/*
src/components/guide/*
src/components/scenic/*
src/api/*
src/types/*
src/styles/*
```

验证脚本：

```text
scripts/verify-visitor-flow.mjs
scripts/verify-admin-flow.mjs
```

运行脚本：

```text
npm.cmd run dev
npm.cmd run build
npm.cmd run verify:visitor
npm.cmd run verify:admin
```

当前交付结论：

前端 P0 基础版已经可演示。后端集成重点是按接口契约补齐 `/api/...`，然后关闭 mock 模式进行联调。
