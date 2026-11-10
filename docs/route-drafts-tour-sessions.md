# 路线草稿与游览会话契约

## 路线草稿

路线草稿是手动编辑阶段的唯一服务端数据源。前端不得在本地维护另一份独立路线真相。

接口：

- `POST /api/route-drafts`
- `GET /api/route-drafts/{id}`
- `POST /api/route-drafts/{id}/spots`
- `DELETE /api/route-drafts/{id}/spots/{spot_id}`
- `POST /api/route-drafts/{id}/spots/reorder`
- `POST /api/route-drafts/{id}/undo`

约束：

- 至少保留一个景点。
- 同一草稿拒绝重复景点。
- 添加位置使用零起始 `position`。
- 排序请求必须提交草稿内全部 `spot_id`。
- 添加和排序后重新计算停留、步行和总时长。
- 超出预算时首次返回 `DRAFT_BUDGET_EXCEEDED`；用户确认后以
  `allow_budget_exceeded=true` 重试。
- 每次成功的添加、删除和排序保存操作前快照；撤销会恢复最近快照并消费该版本。

## 游览会话

开始游览时，服务端冻结路线草稿快照。之后继续编辑草稿不会改变已经开始的游览顺序。

接口：

- `POST /api/tours`
- `GET /api/tours/{id}`
- `POST /api/tours/{id}/events`
- `GET /api/tours/{id}/recap`

支持事件：

- `tour_started`
- `spot_arrived`
- `spot_completed`
- `spot_skipped`
- `route_adjusted`
- `ai_consulted`
- `tour_finished`

首版行为：

- 仅允许操作当前站点。
- 完成或跳过当前站后推进到下一站。
- 最后一站完成或跳过后自动结束游览。
- 不使用浏览器定位自动判断到达。
- 前端每次成功同步后将最近会话写入 localStorage。
- 服务端不可用时显示本地最近状态，但暂停继续推进，避免产生两套真相。

## 行程回顾

回顾页使用实际事件顺序，不使用原计划顺序代替实际游览顺序。当前展示：

- 实际耗时。
- 完成景点数。
- 跳过景点数。
- 路线调整次数。
- 实际完成/跳过顺序。
- 原推荐顺序、计划差异数量和生成时的偏好快照。
- 本次 AI 咨询主题；尚无关联事件时显示空状态。
- 草稿中最终保留的调整版本数与游览中的 `route_adjusted` 事件共同计入调整次数。
- 多模态分支可写入 `ai_consulted` 事件的 `topic` 字段。

## 集成边界

- 地图分支拥有本文件涉及的模型、API、页面与类型。
- 多模态分支若要记录 AI 咨询主题，应通过游览事件数据或新增向后兼容字段关联，
  不直接修改路线草稿顺序。
- UI 分支可提供样式 token，不重构草稿和游览状态机。
- `App.tsx` 和 `backend/app/main.py` 属于共享文件，合并时保留新增路由即可。
