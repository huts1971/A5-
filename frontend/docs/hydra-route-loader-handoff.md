# Hydra 路线加载动画交接

## 来源与落点

- 原始素材目录：`/Users/bebop/code/中软/hydra`
- 原始 CodePen：`https://codepen.io/alex-page/pen/pXNOYN`
- P3-1 组件：`frontend/src/components/scenic/HydraRouteLoader.tsx`
- P3-1 样式：`frontend/src/components/scenic/HydraRouteLoader.module.css`
- 接入页面：游客端 `/routes`，`frontend/src/pages/visitor/RouteRecommendPage.tsx`

## 本地化说明

- 不在运行时引用外部 `hydra` 文件夹。
- 不直接执行原 `script.js` 的全局 DOM 查询脚本。
- 原 HTML/CSS/JS 已改写为 React 组件、CSS Module 和本地 state/timer。
- 原外链噪声背景未保留，已用本地 CSS 纹理替代。
- 加载层通过 React Portal 挂到 `document.body`，避免被路线页布局 transform 限制，确保全屏覆盖。

## 第三方许可

```text
The MIT License (MIT)

Copyright (c) 2026 Alex Page (https://codepen.io/alex-page/pen/pXNOYN)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
