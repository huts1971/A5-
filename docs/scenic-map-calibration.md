# 景区点位与道路路径标定操作说明

## 当前资源状态

- 地图版本：`ling-shan-overview-v1`
- 网页资源：`frontend/public/scenic/maps/ling-shan-overview-v1.webp`
- 数据文件：`knowledge/maps/ling-shan-overview-v1.json`
- 拈花湾地图版本：`nianhua-bay-overview-v1`
- 拈花湾网页资源：`frontend/public/scenic/maps/nianhua-bay-overview-v1.png`
- 拈花湾数据文件：`knowledge/maps/nianhua-bay-overview-v1.json`
- 双地图标定工具：`http://127.0.0.1:5173/tools/scenic-map-calibrator.html`
- 路线模板：`knowledge/routes/route-templates-v1.json`
- 步行时间与人工折线：`knowledge/routes/scenic-route-network-v2.json`

当前 WebP 临时提取自《灵山胜境智能路线系统升级方案》内嵌的无标记鸟瞰图。
正式发布前需要替换为已确认授权的独立高清原图，或确认当前资源可使用。

## 人工标定步骤

1. 启动前端后打开标点工具，并在右侧选择灵山胜境或拈花湾。
2. 保持“点位模式”，从右侧选择景点，在底图上点击建筑中心。
4. 点位出现后可以直接拖动修正。
5. 分别在 1366×768 和 1920×1080 浏览器窗口下复核位置。
6. 工具会自动在当前浏览器保存进度，刷新页面不会丢失。
7. 点击“复制点位 JSON”。
8. 导出内容包含完整 `map` 与 `points` 数据，可直接替换对应的
   `knowledge/maps/*.json`，也可以将文件交给 Codex 导入。
9. 如果替换了正式底图，同时更新数据文件中的 `width`、`height`、
   `source_note` 和 `authorization_status`。
10. 重新启动后端，通过对应接口核对结果：
    - `GET /api/maps/ling-shan`
    - `GET /api/maps/nianhua-bay`

## 人工路径绘制步骤

1. 切换到“路径模式”。
2. 选择起点和终点，工具会自动使用两个景点的已标定坐标作为首尾节点。
3. 沿鸟瞰图中真实可见的道路依次点击，至少添加一个道路节点。
4. 拖动中间节点修正道路形状；可使用“撤销节点”“反向预览”和“清空草稿”。
5. 录入少量已知步行时间作为粗略估算参考；道路不再维护难度、类型或无障碍属性。
6. 点击“保存路径段”。同一起终点再次保存会覆盖旧草稿。
7. 完成当前景区后点击“复制路网 JSON”，将 `edges` 合并到
   `knowledge/routes/scenic-route-network-v2.json`。
8. 重启后端，调用以下接口核对组合路径：

```http
POST /api/maps/{map_id}/route-path
Content-Type: application/json

{"spot_ids": ["spot_a", "spot_b", "spot_c"]}
```

路径缺失时接口会返回 `missing_transitions`，前端只显示已有人工折线，
不会退化为直线连点。

## 坐标规则

- `x_ratio = 点击位置相对图片左侧的距离 / 图片显示宽度`
- `y_ratio = 点击位置相对图片顶部的距离 / 图片显示高度`
- 值必须处于 `0` 到 `1` 之间。
- 不保存像素坐标，因此响应式缩放后点位不会漂移。
- 鸟瞰图不用于计算真实距离或步行时间。
- `ManualPathSegment.points` 同样只保存比例坐标。
- `SpotAdjacency.walk_minutes` 是时间唯一数据源，路径折线不重复保存计算结果。

## 灵山当前状态

灵山胜境 16 个景点均已标定并保存为 `verified`。切换到灵山地图后，
仍可使用本工具拖动复核或重新导出完整数据。

## 拈花湾当前状态

- 拈花广场
- 梵天花海
- 香月花街
- 拈花堂
- 五灯湖
- 鹿鸣谷

以上 6 个景点已于 2026-06-20 在拈花湾鸟瞰图上完成手工标定，
并保存为 `verified`。后续如替换底图版本，必须重新复核全部坐标。
