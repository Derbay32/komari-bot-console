# Komari Bot Console

Komari 机器人的管理后台，用于管理知识库、记忆数据与 LLM 回复日志。

基于 **Next.js 16** (App Router) + **React 19** + **TypeScript** 构建，UI 使用 **Ant Design 6**。

## 功能模块

| 模块 | 说明 |
|------|------|
| **总览** | Dashboard 仪表盘，概览机器人运行状态 |
| **知识库** | 管理机器人的知识文档与条目 |
| **记忆中心** | 查看对话记录、交互历史与用户画像 |
| **回复日志** | 检索和分析 LLM 的回复日志 |
| **公告通知** | 管理系统的公告与通知 |
| **配置管理** | 运行时配置的查看与维护 |
| **帮助文档** | 使用帮助与文档说明 |

## 快速开始

### 环境要求

- Node.js 22+
- npm

### 环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
NEXT_PUBLIC_APP_NAME=Komari 管理后台
KOMARI_API_ORIGIN=http://127.0.0.1:8880
KOMARI_API_BEARER_TOKEN=你的令牌
KOMARI_OPENAPI_URL=http://127.0.0.1:8880/api/komari-management/openapi.json
```

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_APP_NAME` | 前端页面展示名称 |
| `KOMARI_API_ORIGIN` | 后端 API 服务地址，供服务端代理转发使用 |
| `KOMARI_API_BEARER_TOKEN` | 后端 Bearer Token，必填 |
| `KOMARI_OPENAPI_URL` | OpenAPI 规范地址，用于类型同步 |

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

```bash
npm run build
npm run start
```

## 架构说明

前端通过服务端代理（`app/api/proxy/`）转发所有 API 请求到后端，确保凭据不会暴露到客户端。

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
