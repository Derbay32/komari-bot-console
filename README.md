# Komari Bot Console

Komari 机器人的管理后台，用于管理知识库。

基于 **Next.js 16** (App Router) + **React 19** + **TypeScript** 构建，UI 使用 **Ant Design 6**。

## 功能模块

| 模块 | 说明 |
|------|------|
| **总览** | Dashboard 仪表盘，概览机器人运行状态 |
| **知识库** | 管理机器人的知识文档与条目 |
| **公告通知** | 管理系统的公告与通知 |
| **配置管理** | 运行时配置的查看与维护 |
| **帮助文档** | 使用帮助与文档说明 |

## 快速开始

### 环境要求

- Node.js 22.13+
- npm

### 环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
NEXT_PUBLIC_APP_NAME=Komari 管理后台
KOMARI_API_ORIGIN=http://127.0.0.1:8880
KOMARI_API_BEARER_TOKEN=你的令牌
KOMARI_OPENAPI_URL=http://127.0.0.1:8880/api/komari-management/openapi.json
CONSOLE_PUBLIC_ORIGIN=http://localhost:3000
CONSOLE_DATABASE_PATH=/absolute/path/to/komari-console.sqlite
```

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_APP_NAME` | 前端页面展示名称 |
| `KOMARI_API_ORIGIN` | 后端 API 服务地址，供服务端代理转发使用 |
| `KOMARI_API_BEARER_TOKEN` | 后端 Bearer Token，必填 |
| `KOMARI_OPENAPI_URL` | OpenAPI 规范地址，用于类型同步 |
| `CONSOLE_PUBLIC_ORIGIN` | 控制台公开来源，必填 |
| `CONSOLE_DATABASE_PATH` | 控制台 SQLite 数据库的绝对文件路径，必填 |

### 启动开发服务器

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

### 类型检查

```bash
npm run typecheck
```

### 构建生产版本

1. 运行 `npm run build`。预期结果：生成 Next.js 产物，并将维护通知 Worker 编译到 `dist/maintenance-worker`。
2. 运行 `npm run start`。预期结果：控制台 Web 服务启动。
3. 在另一个终端运行 `npm run start:worker`。预期结果：维护通知 Worker 开始轮询本地任务。

## 控制台登录

控制台只提供一个管理员账号。`CONSOLE_PUBLIC_ORIGIN` 和 `CONSOLE_DATABASE_PATH` 必填。仓库不提供默认密码。

### 首次启动与初始密码

1. 启动 Web 服务。预期结果：服务端生成随机初始密码，并在标准输出显示用户名和密码。
2. 保存该密码。检查：密码只显示一次，数据库中只保存密码哈希。
3. 在登录页输入用户名 `admin` 和该密码。预期结果：进入控制台。

数据库没有账户记录、密码为 `NULL` 或密码为空时，服务端在启动阶段生成新密码。
初始化时用户名固定为 `admin`。已有有效密码时，服务端保留原用户名和密码。

服务端只在凭据事务提交成功后显示一次密码。正常重启不重新生成密码，也不再次显示密码。
如果服务端在事务提交后、日志输出前退出，重启不会恢复密码。此时必须使用服务端密码重置命令恢复登录。

警告：日志中的初始密码等同于管理员凭据。包含该密码的日志必须限制为凭据级访问权限。禁止公开或提交包含该密码的日志。

认证接口每次读取 SQLite 中的当前凭据。服务端不读取 `CONSOLE_ADMIN_USERNAME` 和 `CONSOLE_ADMIN_PASSWORD_HASH`，也不回退使用这两个变量。
服务端在启动阶段初始化管理员凭据。初始化失败时，启动钩子返回错误，正常请求处理不启动。
服务端运行期间，缺少必填变量、值格式错误或凭据损坏时，登录接口返回 500 和固定错误文案。
未登录时，会话接口返回 401。

登录成功后，服务端签发会话 Cookie。Cookie 名为 `komari_console_session`。
Cookie 包含 `HttpOnly`、`SameSite=Strict`、`Path=/` 属性。如果 `CONSOLE_PUBLIC_ORIGIN` 使用 HTTPS，Cookie 还包含 `Secure` 属性。

会话有效期为 8 小时。退出登录后，服务端立即撤销会话。
60 秒窗口内登录失败达到 10 次后，登录接口返回 429。

`CONSOLE_PUBLIC_ORIGIN` 必须写纯来源，例如 `https://console.example.com`。该值不能包含用户信息、路径、查询参数或片段。
HTTP 来源只允许 `localhost`、`127.0.0.1` 和 `[::1]`。其他主机必须使用 HTTPS。
`CONSOLE_DATABASE_PATH` 必须是绝对文件路径。服务端在第一次使用数据库时创建目录和 SQLite 文件。

## 维护通知 Worker

控制台进程只创建和读取维护通知任务。Worker 是独立进程。Worker 从同一个 SQLite 数据库领取任务，并调用上游发送接口。

Worker 读取 3 个环境变量：

| 变量 | 说明 |
|------|------|
| `CONSOLE_DATABASE_PATH` | 与 Web 服务相同的 SQLite 绝对文件路径 |
| `KOMARI_API_ORIGIN` | 上游 API 来源地址 |
| `KOMARI_API_BEARER_TOKEN` | 上游 Bearer Token，只保存在服务端 |

`npm run start:worker` 使用 Next.js 的 `@next/env` 加载 `.env`。加载规则与 Web 服务一致。进程环境变量优先于 `.env`。

Worker 每 1000 毫秒轮询一次 `runOnce`。未启动 Worker 时，已保存任务保持待发送状态。

定时任务的计划发送时间按 Asia/Shanghai（UTC+8）解释。Worker 在计划时间至计划时间后 60 秒（含）之间开始发送。计划时间后超过 60 秒仍未开始的任务标记为「已错过」。Worker 不补发已错过任务。

执行进程重启后，Worker 恢复未开始的任务。运行中断且结果未知的任务保留原请求标识。Worker 不自动重发结果未知的任务。

收到 `SIGTERM` 或 `SIGINT` 后，Worker 停止轮询，等待当前请求结束，再退出进程。

发送请求不使用自动重试。上游返回 409 或结果未知时，Worker 记录证据并标记人工核对状态。

警告：Worker 自动删除 30 天前的已结束通知历史。

保留期限从最近一次实际执行尝试的结束时间起算。
如果通知没有实际执行尝试，保留期限从通知自身的结束时间起算。
通知存在排队中或执行中的尝试时，Worker 不删除该通知。
实际执行的重试结束后，系统重置保留期限。

查看列表或详情不延长保留期限。
删除后无法通过控制台界面恢复。
控制台保留期不延长上游请求标识的幂等窗口。

`npm run build` 在 Next.js 构建后编译 Worker。存在 `.next/standalone` 时，构建脚本将 Worker 产物复制到 `.next/standalone/maintenance-worker`。

生产环境必须为 Web 服务与 Worker 提供同一个可持久化 SQLite 文件。仓库不包含该持久卷的部署配置。

## 架构说明

前端通过服务端代理（`app/api/proxy/`）转发所有后端 API 请求，确保凭据不会暴露到客户端。
代理在转发前校验登录会话。修改类请求还校验 `Origin` 请求头。

维护通知任务通过 `/api/console/announcements` 写入本地 SQLite 数据库。浏览器不直接调用上游维护通知接口。
独立 Worker 领取本地任务后，由服务端发送请求并保存逐群证据。

API 类型定义通过 OpenAPI 规范生成：

```bash
npm run gen:api
```

## Docker 部署

项目支持多阶段 Docker 构建，使用 Next.js standalone 输出。

```bash
docker compose up -d --build
```

详细部署说明见 [docs/docker-compose 部署文档.md](docs/docker-compose%E9%83%A8%E7%BD%B2%E6%96%87%E6%A1%A3.md)。

## 技术栈

- **框架**: Next.js 16 (App Router)
- **构建工具**: TypeScript, ESLint
- **UI 组件**: Ant Design 6, @ant-design/icons
- **状态管理**: @tanstack/react-query
- **主题**: next-themes (支持浅色/深色/跟随系统)
- **代码编辑器**: @monaco-editor/react
- **容器化**: Docker (多阶段构建, standalone 输出)

## 许可证

[MIT](LICENSE)
