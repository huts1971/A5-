灵诗音 Agentic Guide 部署说明

请以项目根目录 README.md 为统一启动入口。
模型服务与详细配置：docs/deployment.md；架构：docs/architecture.md。

环境：Python 3.11/3.12、Node.js 20+，Agentic 检索还需要 Milvus 和本地模型。
配置：scripts/configure-local.py 生成 backend/.env 和 configs/core.local.toml。
首次使用：安装依赖，初始化业务数据，重建检索索引。
开发模式：backend 目录运行 uvicorn，frontend 目录运行 npm run dev。
静态模式：先 BUILD-FRONTEND.bat，再 START-HERE.bat。
停止：stop-local.bat；模型服务和 Milvus 单独关闭。

源码目录不包含业务数据库、模型权重、构建产物或真实密钥。
第三方资源的公开再分发授权请在发布前核对 THIRD_PARTY_NOTICES.md。
