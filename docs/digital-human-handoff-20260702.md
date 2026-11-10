# Unity WebGL 数字人模块

数字人位于游客端 /guide。React 加载 Unity WebGL，将聊天、音频和表情状态发送给 Unity 控制器。

## 文件

| 文件 | 功能 |
| --- | --- |
| frontend/src/components/guide/UnityWebGLGuideStage.tsx | 加载实例、透明合成、状态同步与卸载清理 |
| frontend/src/config/avatar151Guide.ts | 资源 URL、版本号与桥接配置 |
| frontend/src/styles/global.css | 舞台和 canvas 布局 |
| frontend/public/avatar/uketsukejou151/ | 模型及 WebGL 资源 |
| tools/unity/Avatar151GuideWebGLController.cs | 动作、口型、眨眼与表情 |
| tools/unity/Avatar151GuideWebGLBuilder.cs | 场景、相机、材质和资源构建 |
| tools/unity/ArmOutwardCorrection.cs | 手臂姿态修正 |
| tools/unity/Avatar151FrontendMotionBaker.cs | 动作烘焙 |

资源 URL 携带 avatar151Guide.ts 中的 unityWebglVersion，更新构建包时同步更新版本。

## 渲染与状态

Unity 负责 Humanoid 动作重定向与 Animator 播放。前端读取原始 canvas，识别键控背景，合成带 alpha 的展示 canvas；场景就绪后显示数字人。

SendMessage 调用配置中的桥接对象：

| 方法 | 内容 |
| --- | --- |
| SetGuideState | welcome / idle / thinking / speaking / fallback |
| SetSpeechText | 讲解文本 |
| SetEmotionCue | 情绪状态 |
| SetExpressionCue | 表情提示 |

音频播放状态参与 speaking 判定。Unity 控制器组合动作、眨眼和口型权重；前端通过 requestAnimationFrame 合成画面，卸载时释放循环与实例。

## 启动与资源管理

开发启动按 [README](../README.md) 操作。静态部署先构建 frontend/dist，再使用 START-HERE.bat。账号通过游客注册或本地管理员配置创建。

前端舞台由样式控制；相机、光照、材质和动作由 tools/unity 中的场景脚本管理。资源来源与许可见 [第三方资源](../THIRD_PARTY_NOTICES.md)。

