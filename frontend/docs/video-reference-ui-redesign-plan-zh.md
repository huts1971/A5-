# 视频参考风格 UI 改造计划

## 1. 已确认上下文

- 已阅读项目交接与约束：`AGENTS.md`、`README-local-run.md`、`backend-frontend-handoff-summary-zh-v2.md`、`frontend/AGENTS.md`、`frontend/CONTEXT.md`、`ARCHITECTURE.md`、`FOLDER_STRUCTURE.md`、`UI_GUIDELINES.md`、`git-instruction.md`。
- 已观看并抽帧分析用户提供的视频：33.6 秒，主要参考点为黑底高留白、超大品牌字、括号化英文导航、等宽 `[SCROLL DOWN]` 提示、局部图片切片、细线图形、轻微悬浮 hover 标识。
- 当前前端是 React 18 + Vite + TypeScript + Ant Design + GSAP/Lenis；不能换框架、不能绕过 `src/api`、不能破坏现有路由和后端接口。
- 当前本地目录没有 `.git`，需要按 `git-instruction.md` 先初始化基线再提交改造结果，除非你确认改用新 clone。

## 2. 视频审美逻辑提炼

本次不是照搬视频品牌内容，而是模仿它的视觉语法：

- 背景：近黑色哑光画布，少量深灰、鼠尾草绿、暖白作为层次，不再使用大面积浅色卡片。
- 字体：主标题采用轻奢衬线/宋体气质，英文标签和交互提示使用等宽字体；字号层级拉开，文字量减少。
- 导航：使用小号英文括号标签，例如 `[ SPOTS ]`、`[ GUIDE ]`，保留中文业务可读性但降低装饰噪声。
- 图片：用现有景点照片做“切片/大图/局部遮罩”，而不是重新引入外部素材。
- hover：卡片、图片、按钮悬停时轻微上浮；同时出现小型英文提示，如 `[ OPEN ]`、`[ ASK GUIDE ]`、`[ ROUTE ]`。
- 线条：用细边框、细分割线、编号、坐标感标签组织信息，避免厚重阴影和圆润卡片堆叠。
- 动效：保留首页已有 Lenis/GSAP 滚动逻辑，只收敛视觉；子页面用轻量 CSS transition，不引入复杂新动效。

## 3. 改造目标

1. 首页只做小改：保留现有滚动结构、数字人和视差，不大动布局与动效；调整为更接近视频的黑白极简、括号导航、滚动提示和 hover 标识。
2. 子页面大改：`/spots`、`/spots/:spotId`、`/routes`、`/guide` 从浅色资料卡改为暗色轻奢界面。
3. 管理后台适度统一：保持运营效率和表格可读性，只把外壳、卡片、按钮、表格边界改成同一套深色视觉，不做花哨营销式布局。
4. 不改后端、不改 API、不改知识库、不改 Live2D 模型资源，不新增 UI 框架。

## 4. 具体实施范围

### 4.1 Git 准备

- 在 `A5--main` 执行 `git init`。
- 按文档做基线提交：`baseline from A5 zip archive`。
- 新建分支：`feature/video-reference-ui-redesign`。
- 完成并验证后提交：`feat: align visitor ui with video reference`。

### 4.2 共享视觉系统

修改文件：

- `frontend/src/styles/theme.ts`
- `frontend/src/styles/global.css`

计划内容：

- 统一暗色 token：黑底、暖白文字、鼠尾草绿线条、少量金色强调。
- 设置字体栈：主标题优先 `Didot / Bodoni 72 / Georgia / Songti SC / Noto Serif CJK SC`，提示与标签使用 `SFMono-Regular / Menlo / Consolas`。
- 重写 AntD 基础控件暗色样式：Button、Card、Tag、Input、Select、Table、Menu、Alert、Descriptions。
- 加通用 hover cue 规则：`.hover-cue` / `data-cue`，悬停时显示 `[ OPEN ]` 这类小英文提示。
- 保证移动端不溢出、不重叠。

### 4.3 布局与导航

修改文件：

- `frontend/src/layouts/VisitorLayout.tsx`
- `frontend/src/layouts/AdminLayout.tsx`

计划内容：

- 游客端导航改为视频式括号英文标签：`[ HOME ]`、`[ SPOTS ]`、`[ ROUTES ]`、`[ GUIDE ]`。
- 品牌区改成更轻的字标，不再依赖厚重图标块。
- 后台入口保留，但视觉降噪，避免抢主视觉。
- 管理后台外壳同步深色化，但菜单仍清晰可扫。

### 4.4 首页小改

修改文件：

- `frontend/src/pages/visitor/HomePage.tsx`
- `frontend/src/styles/global.css`

计划内容：

- 保留现有 `Lenis + GSAP + AvatarGuide` 结构。
- 增加或强化 `[SCROLL DOWN]` 中央提示，样式按截图的等宽括号白字实现。
- 首页按钮和快捷入口改为 bracket label 风格。
- 背景照片处理更接近视频：更暗、更克制、局部高亮，减少金色酒店感。
- hover 到照片/数字人区域时显示小方块/小标签提示。

### 4.5 景点列表大改

修改文件：

- `frontend/src/pages/visitor/SpotListPage.tsx`
- `frontend/src/components/scenic/SpotCard.tsx`
- `frontend/src/styles/global.css`

计划内容：

- 景点列表从普通三列浅卡改成暗色 editorial grid。
- 每张卡使用真实照片，图片占主导，文字精简为编号、景点名、标签、停留时间。
- 卡片 hover：上浮、图片轻微放大，右上出现 `[ OPEN ]` 或 `[ VIEW ]`。
- 页面顶部加入大标题和短英文标签，不新增使用说明文字。

### 4.6 景点详情大改

修改文件：

- `frontend/src/pages/visitor/SpotDetailPage.tsx`
- `frontend/src/styles/global.css`

计划内容：

- 顶部改成大图 + 大字号景点名 + 极简元信息。
- 导游讲解词、游览信息、AI 提问入口改成细线分区，而不是普通白底卡片。
- AI 入口 hover 显示 `[ ASK GUIDE ]`。
- 保留返回、问 AI、加入路线推荐的功能路径。

### 4.7 路线推荐大改

修改文件：

- `frontend/src/pages/visitor/RouteRecommendPage.tsx`
- `frontend/src/components/scenic/PreferenceForm.tsx`
- `frontend/src/components/scenic/RouteCard.tsx`
- `frontend/src/styles/global.css`

计划内容：

- 偏好表单改成暗色控制台式面板，字段间距更克制。
- 路线卡用编号、细线时间轴、少量标签表现，去掉浅色提示块。
- 推荐理由改为“理由片段”式文本块，hover 显示 `[ ROUTE ]`。
- 保留当前推荐逻辑、错误态和重试路径。

### 4.8 AI 导游页大改

修改文件：

- `frontend/src/pages/visitor/AiGuidePage.tsx`
- `frontend/src/components/guide/ChatBox.tsx`
- `frontend/src/components/guide/SourceCard.tsx`
- `frontend/src/components/guide/AudioButton.tsx`（仅必要时）
- `frontend/src/styles/global.css`

计划内容：

- 左侧数字人控制台暗色化，预设问题改成小号 bracket chip。
- 聊天气泡改成低对比深色面板，用户/AI 通过边线和位置区分。
- 来源卡片改成轻量“evidence strip”，保留来源、类型、链接。
- 发送、语音输入、播放讲解按钮统一 hover 上浮和英文提示。
- 不改流式问答、TTS、来源展示逻辑。

### 4.9 管理后台适度统一

修改文件：

- `frontend/src/pages/admin/*.tsx` 仅在必要时加 className 或去掉冲突内联样式
- `frontend/src/styles/global.css`

计划内容：

- 后台不做沉浸式视觉，保持密集表格和操作效率。
- 深色布局、细线卡片、暗色表格、稳定按钮状态。
- 知识库、日志、景点管理、路线管理保留所有现有 CRUD 和筛选行为。

## 5. 验证计划

必须运行：

- `cd frontend && ../.tools/node/bin/npm run build`

如本机服务可启动，再运行：

- `./scripts/start-dev-macos.sh`
- 手动检查：
  - `http://127.0.0.1:5173/`
  - `http://127.0.0.1:5173/spots`
  - `http://127.0.0.1:5173/routes`
  - `http://127.0.0.1:5173/guide`
  - `http://127.0.0.1:5173/admin`

优先补跑：

- `cd frontend && ../.tools/node/bin/npm run verify:visitor`
- `cd frontend && ../.tools/node/bin/npm run verify:admin`

视觉验收：

- 桌面与手机宽度无横向滚动、无按钮文字溢出。
- 首页仍能滚动切换，数字人仍显示。
- 子页面 hover 有轻微上浮和英文提示。
- 聊天、TTS、来源卡、路线推荐、管理后台表格功能不回退。

## 6. 风险与处理

- 当前仓库无 `.git`：按文档初始化和基线提交，避免改造后无法区分变更。
- 现有 `PLAN.md` 属于上一轮 P2 计划：本计划单独存放，不覆盖旧计划。
- 视频参考偏品牌官网，项目是景区导览产品：游客端可强风格化，后台必须保留运营效率。
- 暗色 AntD 表格和表单容易出现对比度问题：统一 token 后逐页检查。
- 首页已有 Lenis/GSAP：只收敛视觉，不重写滚动逻辑，降低破坏风险。

## 7. 等待确认

确认后再开始执行代码改造。若你确认这份计划，我会先做 git 基线与分支，再按上面的顺序实现、构建、验证并提交。
