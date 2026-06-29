# A5 本地开发启动手册

## 1. 项目地址

```bash
cd /Users/bebop/code/中软/A5--main
```

## 2. macOS 首次部署

```bash
./scripts/bootstrap-macos.sh
```

部署完成后应存在：

```text
.tools/node/bin/node
.tools/node/bin/npm
.tools/python/bin/python3
backend/.venv/bin/python
frontend/node_modules
backend/.env
frontend/.env.local
```

## 3. macOS 开发启动

```bash
./scripts/start-dev-macos.sh
```

访问地址：

| 页面 | 地址 |
| --- | --- |
| 游客端首页 | http://127.0.0.1:5173/ |
| AI 导游页 | http://127.0.0.1:5173/guide |
| 管理后台 | http://127.0.0.1:5174/ |
| 后端接口 | http://127.0.0.1:8001 |
| Swagger 文档 | http://127.0.0.1:8001/docs |
| 健康检查 | http://127.0.0.1:8001/health |

## 4. macOS 停止服务

```bash
./scripts/stop-dev-macos.sh
```

## 5. macOS 日志

```text
backend/backend-dev-server-8001.log
backend/backend-dev-server-8001.err.log
frontend/frontend-dev-server-5173.log
frontend/frontend-dev-server-5173.err.log
```

查看日志：

```bash
tail -n 80 backend/backend-dev-server-8001.log
tail -n 80 backend/backend-dev-server-8001.err.log
tail -n 80 frontend/frontend-dev-server-5173.log
tail -n 80 frontend/frontend-dev-server-5173.err.log
```

## 6. macOS 常用验证

后端测试：

```bash
cd backend
../.tools/python/bin/python3 -m pytest -q
```

前端构建：

```bash
cd frontend
../.tools/node/bin/npm run build
```

游客端流程验证：

```bash
cd frontend
../.tools/node/bin/npm run verify:visitor
../.tools/node/bin/npm run verify:visitor-auth
../.tools/node/bin/npm run verify:dual-entrypoints
```

管理端流程验证：

```bash
cd frontend
../.tools/node/bin/npm run verify:admin
../.tools/node/bin/npm run verify:admin-login
../.tools/node/bin/npm run verify:admin-api-auth
```

## 7. Python 手动下载

如果 `bootstrap-macos.sh` 下载 Python 很慢，手动下载这个文件：

```text
https://github.com/astral-sh/python-build-standalone/releases/download/20260610/cpython-3.12.13%2B20260610-aarch64-apple-darwin-install_only.tar.gz
```

下载后放到以下任一位置：

```text
/Users/bebop/code/中软/A5--main/cpython-3.12.13+20260610-aarch64-apple-darwin-install_only.tar.gz
/Users/bebop/code/中软/A5--main/.tools/cpython-3.12.13+20260610-aarch64-apple-darwin-install_only.tar.gz
```

然后重新运行：

```bash
cd /Users/bebop/code/中软/A5--main
./scripts/bootstrap-macos.sh
```

## 8. Windows 启动

### 8.1 首次安装 LiteAvatar

A5 backend 保持原有虚拟环境不变。OpenAvatarChat 和 avatar bridge 分别使用
`avatar-service/vendor/OpenAvatarChat/.venv` 与 `avatar-service/.venv`，要求本机可用
Python 3.11 和 [uv](https://docs.astral.sh/uv/)。

首次运行：

```bat
SETUP-AVATAR.bat
```

该脚本会：

1. 将 OpenAvatarChat 固定到项目验证过的提交。
2. 安装 SenseVoice、百炼 Qwen3-TTS Realtime 和 LiteAvatar 所需依赖。
3. 下载 LiteAvatar 推理权重与默认人物 `20250408/sample_data`。
4. 创建独立的 avatar bridge 环境。
5. 生成本地 `avatar-service/.env`。

模型下载与首次初始化耗时取决于网络和磁盘速度。模型和上游仓库位于
`avatar-service/vendor/`，不会进入 Git。只想先验证环境而暂不下载模型时可执行：

```powershell
powershell -ExecutionPolicy Bypass -File avatar-service\setup-avatar.ps1 -SkipModels
```

在 `avatar-service/.env` 中填写百炼 Qwen3-TTS Realtime 使用的密钥：

```text
DASHSCOPE_API_KEY=你的本地密钥
```

密钥不得提交到仓库。默认人物和端口通过
`avatar-service/openavatar/a5_liteavatar.yaml` 与环境变量配置，不提供后台配置页。

### 8.2 一键联合启动

完成首次安装和前端构建后使用：

```bat
START-HERE.bat
```

或：

```bat
start-local.bat
```

Windows 停止服务：

```bat
stop-local.bat
```

Windows 前端重新构建：

```bat
BUILD-FRONTEND.bat
```

联合启动包含：

| 服务 | 地址 |
| --- | --- |
| 游客端 | http://127.0.0.1:5173/ |
| AI 导游 | http://127.0.0.1:5173/guide |
| A5 backend | http://127.0.0.1:8001 |
| Avatar bridge 健康检查 | http://127.0.0.1:8283/health |
| OpenAvatarChat | http://127.0.0.1:8282 |

如果 avatar 环境尚未安装或模型未就绪，`START-HERE.bat` 仍会启动 A5 文字问答，
`/guide` 左侧显示“未连接”或“准备中”，不会补播服务恢复前错过的回答。

### 8.3 Avatar 日志与检查

```text
avatar-service/avatar-local-server-8283.log
avatar-service/avatar-local-server-8283.err.log
```

健康检查返回进程和模型状态：

```powershell
Invoke-RestMethod http://127.0.0.1:8283/health
Invoke-RestMethod http://127.0.0.1:8283/readiness
```

`health` 可访问但 `ready=false` 表示 supervisor 存活、OpenAvatarChat 仍在加载。
`readiness` 返回 200 后才代表 LiteAvatar 可接收新问题。

### 8.4 常见故障

- 模型缺失：重新运行 `SETUP-AVATAR.bat`，或在 OpenAvatarChat 目录执行
  `uv run scripts/download_models.py --handler liteavatar` 和
  `uv run scripts/download_avatar_model.py --model "20250408/sample_data"`。
- 显存不足：关闭其它 GPU 程序后重启。本地目标设备为 RTX 4060 Laptop 8GB，
  首版只验收单浏览器、单 session，不支持并发。
- 内存或页面文件不足：默认人物为 890 x 1920，OpenAvatarChat、SenseVoice 和
  LiteAvatar 合计需要较大的 Windows 提交内存。若日志出现 `WinError 1455`、
  `MemoryError` 或“页面文件太小”，请启用“自动管理所有驱动器的分页文件大小”
  （或预留至少 16 GB 页面文件），重启 Windows，并避免在数字人运行时并行执行
  前端构建、pytest 或其它大型模型。
- Avatar 未连接：检查 8282、8283 端口和两个 avatar 日志；运行
  `stop-local.bat` 后再执行 `START-HERE.bat`。
- 麦克风不可用：使用 Chrome 或 Edge，允许 `127.0.0.1:5173` 的麦克风权限；
  权限失败不影响文字提问。
- 百炼 TTS 失败：检查 `avatar-service/.env` 中的 `DASHSCOPE_API_KEY`，并确认
  当前地域已开通 `qwen3-tts-instruct-flash-realtime-2026-01-22`。
- 端口占用：执行 `stop-local.bat` 清理 8282、8283 及 A5 演示端口。
- 首次人物加载较慢：等待 `/readiness` 变为 200；准备期间的回答不会排队补播。

### 8.5 本地验收记录（2026-06-28）

目标设备：NVIDIA GeForce RTX 4060 Laptop GPU（8 GB 显存），单浏览器、
单 avatar session。

- OpenAvatarChat、SenseVoiceSmall、LiteAvatar 权重和默认人物
  `20250408/sample_data` 已完成本地下载与首次初始化。
- `http://127.0.0.1:8282/readiness` 和
  `http://127.0.0.1:8283/readiness` 均返回 200。
- `/guide` 已实测完成 WebRTC Offer/Answer、ICE、session 创建和销毁，并收到
  890 x 1920 的 LiteAvatar 视频轨；服务端持续输出约 25 FPS。
- 文字流式转发、麦克风开始/结束、最终 ASR 回填、打断、有限重连和不可用降级
  均有自动化行为测试覆盖。
- 当前默认 TTS 为百炼
  `qwen3-tts-instruct-flash-realtime-2026-01-22`，使用 24 kHz 单声道 PCM
  流式驱动 LiteAvatar。填写有效密钥后，在 `/guide` 发送一句
  文字问题，确认首批回答出现后开始念白；念白中发送第二个问题，确认旧语音立即
  停止；再点击麦克风开始、说话、点击结束，确认识别文字作为普通消息自动发问。
- 断线人工复验：念白前停止 8282/8283，确认左侧显示“未连接”且文字回答与来源卡
  继续完成；重新启动后只验证下一条新问题会播报，旧回答不得补播。

## 9. 环境变量

本地后端配置文件：

```text
backend/.env
```

前端开发配置文件：

```text
frontend/.env.local
```

默认前端接口地址：

```text
VITE_API_BASE_URL=http://127.0.0.1:8001
VITE_AVATAR_SERVICE_URL=http://127.0.0.1:8283
VITE_OPENAVATAR_URL=http://127.0.0.1:8282
VITE_USE_MOCK_API=false
```

Avatar 本地配置文件 `avatar-service/.env` 支持：

```text
A5_OPENAVATAR_ROOT=vendor/OpenAvatarChat
A5_OPENAVATAR_CONFIG=config/a5_liteavatar.yaml
A5_OPENAVATAR_HOST=127.0.0.1
A5_OPENAVATAR_PORT=8282
DASHSCOPE_API_KEY=
```

`A5_OPENAVATAR_ROOT` 同时决定 vendor、`models/` 与人物资源的本地根位置；
若修改上游 host/port，请同步调整前端 `VITE_OPENAVATAR_URL`。8283 bridge
监听端口由 `scripts/run-avatar-stable.cmd` 或手工 uvicorn 命令指定。

真实 LLM、联网补充密钥只写入本地 `backend/.env`；Avatar TTS 密钥只写入
`avatar-service/.env`。不要将任何真实密钥提交到仓库。
