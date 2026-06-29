# A5 项目首次部署指南（Windows）

本文面向首次拿到项目源码的开发同事。完成一次安装后，日常只需运行
`START-HERE.bat` 和 `stop-local.bat`。

## 1. 环境要求

建议使用 Windows 10/11，并提前安装：

- Git
- Node.js 18 或更高版本（包含 npm）
- Python 3.12：用于 A5 backend；backend 实际兼容 Python 3.10+
- Python 3.11：专用于 OpenAvatarChat 和 LiteAvatar
- `uv`：建议执行 `py -3.11 -m pip install uv`
- 最新 NVIDIA 显卡驱动

LiteAvatar 本地推理建议使用至少 8 GB 显存的 NVIDIA GPU。首次下载模型需要稳定
网络和足够磁盘空间；Windows 建议开启自动管理页面文件，或至少预留 16 GB。

可先检查命令是否可用：

```powershell
git --version
node --version
npm --version
py -3.12 --version
py -3.11 --version
uv --version
```

## 2. 安装 A5 Backend

在项目根目录打开 PowerShell：

```powershell
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

编辑 `backend/.env`，填写项目实际使用的 LLM 密钥。MiMo 配置可以使用：

```text
MIMO_API_KEY=你的本地密钥
```

也可以填写 `LLM_API_KEY`。不配置真实 LLM 密钥时，系统仍可使用本地检索兜底，
但不会获得完整的真实模型体验。

不要把 `.env` 或任何真实密钥提交到 Git。

## 3. 安装前端

```powershell
cd frontend
npm ci
cd ..
```

生成用于一键启动的静态前端：

```bat
BUILD-FRONTEND.bat
```

## 4. 安装 LiteAvatar

在项目根目录运行：

```bat
SETUP-AVATAR.bat
```

该脚本会：

1. 下载项目固定版本的 OpenAvatarChat。
2. 创建独立的 Python 3.11 虚拟环境。
3. 安装 SenseVoice、Qwen3-TTS Realtime 和 LiteAvatar 依赖。
4. 下载 LiteAvatar 推理权重与默认人物模型。
5. 创建 `avatar-service/.env`。

安装完成后编辑 `avatar-service/.env`：

```text
DASHSCOPE_API_KEY=你的百炼 API Key
```

当前默认 TTS 模型为：

```text
qwen3-tts-instruct-flash-realtime-2026-01-22
```

请确认该百炼账号和地域已开通此模型。A5 backend 与 Avatar 使用相互独立的虚拟
环境，不要尝试合并。

只验证依赖、不重新下载模型时可以运行：

```powershell
powershell -ExecutionPolicy Bypass -File avatar-service\setup-avatar.ps1 -SkipModels
```

## 5. 启动项目

```bat
START-HERE.bat
```

启动后访问：

| 服务 | 地址 |
| --- | --- |
| 游客端 | http://127.0.0.1:5173/ |
| AI 导游 | http://127.0.0.1:5173/guide |
| 管理后台 | http://127.0.0.1:5174/ |
| 后端接口文档 | http://127.0.0.1:8001/docs |
| Avatar 健康检查 | http://127.0.0.1:8283/health |

停止全部本地服务：

```bat
stop-local.bat
```

前端代码发生变化后，重新执行：

```bat
BUILD-FRONTEND.bat
START-HERE.bat
```

## 6. 首次验收

1. 打开 `/guide`，确认左侧出现 LiteAvatar，而不是“未连接”。
2. 输入一个景区问题，确认文字回答正常流式显示。
3. 确认数字人使用 Qwen3-TTS 对同一回答进行念白。
4. 念白过程中发送新问题，确认旧念白被打断。
5. 点击麦克风开始说话，再次点击结束，确认识别文字进入正常问答链路。

可执行以下自动化检查：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

```powershell
cd avatar-service
.\.venv\Scripts\python.exe -m pytest -q tests
```

```powershell
cd frontend
npm test
npm run build
```

## 7. 常见问题

- Avatar 长时间“准备中”：首次模型加载较慢，检查
  `http://127.0.0.1:8283/readiness` 和 `avatar-service/*.log`。
- TTS 无声音：检查 `DASHSCOPE_API_KEY`、模型权限和网络。
- 显存或页面文件不足：关闭其他 GPU 程序，增大 Windows 页面文件后重启。
- 端口被占用：先运行 `stop-local.bat`，再重新启动。
- 前端仍是旧页面：重新运行 `BUILD-FRONTEND.bat`，并在浏览器强制刷新。
- Avatar 安装失败：确认 `git`、`uv` 和 `py -3.11` 均可在 PowerShell 中执行。

更详细的运行、日志和故障说明见 `README-local-run.md`。
