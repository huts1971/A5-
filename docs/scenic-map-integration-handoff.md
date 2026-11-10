# 地图导航分支集成交接

## 分支

- 功能分支：`feature/scenic-map-navigation`
- 集成分支：`integration/next-demo`
- 基线提交：`7a79c27`

## 本阶段拥有的文件边界

地图分支主要维护：

- `backend/app/api/maps.py`
- `backend/app/services/maps.py`
- `knowledge/maps/`
- `frontend/src/api/maps.ts`
- `frontend/src/components/scenic/ScenicPointMap*`
- `frontend/src/components/scenic/RouteMapWorkbench*`
- `frontend/public/scenic/maps/`
- `frontend/public/tools/scenic-map-calibrator.html`
- `knowledge/routes/ling-shan-adjacency-v1.json`

共享文件中的改动保持最小：

- `backend/app/main.py` 只注册地图路由。
- `backend/app/models/__init__.py` 只新增地图表。
- `backend/app/schemas/__init__.py` 只新增地图响应结构。
- `backend/app/services/bootstrap.py` 只新增地图数据导入。
- `frontend/src/types/scenic.ts` 只新增地图类型。
- `frontend/src/pages/visitor/RouteRecommendPage.tsx` 只用地图工作台包装路线结果。
- `frontend/src/components/scenic/RouteCard.tsx` 只增加地图联动状态。

## 阶段 2 路线时间契约

`POST /api/routes/recommend` 保留原字段，并新增：

- 路线级：`stay_minutes`、`estimated_walk_minutes`、`time_data_complete`
- 景点级：`transition_minutes`、`transition_note`

`total_minutes` 在时间数据完整时等于停留时间和步行时间之和。时间数据不完整时
沿用旧路线模板总时长，并将 `time_data_complete` 设为 `false`。

## 阶段 3 与阶段 4 契约

- 新增路线草稿的添加、删除、排序、预算确认和连续撤销。
- 新增 `/route-drafts/:id`，路线状态以服务端 RouteDraft 为准。
- 新增 `/tour/:id` 和 `/tour/:id/recap`。
- 游览开始时冻结路线快照，刷新后从服务端恢复当前步骤。
- 服务异常时 localStorage 仅保存最近状态并暂停推进，不成为第二套路线真相。
- 详细契约见 `docs/route-drafts-tour-sessions.md`。

## 合并要求

1. UI 分支不要重构 `RouteMapWorkbench` 和 `ScenicPointMap` 的 DOM。
2. 公共颜色或字体变化应通过现有 CSS 变量影响地图外围，地图内部使用局部 CSS Module。
3. 多模态分支不要修改 `/api/maps` 或地图点位类型。
4. 合并时不要携带 `frontend/dist`、本地数据库、日志、`.env`、虚拟环境或
   `node_modules`。
5. 三条分支合并完成后统一执行前端构建，再决定是否更新受版本控制的
   `frontend/dist`。
