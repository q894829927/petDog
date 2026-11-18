# 倩岚汪

一款以任天狗（Nintendogs）为玩法参考的 3D 宠物养成互动游戏。第一只宠物是一只柴犬。

## 项目目标

让玩家通过抚摸、呼唤、喂食、玩耍和照顾，与一只会自主活动、具有性格和情绪反馈的柴犬建立长期陪伴关系。

- Web 游戏，适配桌面浏览器和手机浏览器。
- 注册、登录与云端存档，支持跨设备继续游戏。
- 宠物状态按服务器时间自然变化，离线期间也会持续变化。
- 第一阶段只制作一只柴犬，优先打磨互动反馈和自主行为。

## 文档

- [产品需求文档（PRD）](docs/PRD.md)
- [技术设计文档](docs/TECHNICAL_DESIGN.md)
- [部署与发布方案](docs/DEPLOYMENT.md)
- [开发路线图](docs/ROADMAP.md)

## 技术栈

- 前端：Vite、React、TypeScript、Three.js、React Three Fiber、Zustand
- 后端：Node.js、TypeScript、Fastify
- 数据库：SQLite、Drizzle ORM
- 认证：Argon2id、服务端 Session、HttpOnly Cookie
- 测试：Vitest、Playwright

## 当前部署状态

前端 Vite 项目已配置独立 GitHub Actions 发布工作流，目标地址：

- https://47.119.122.133/games/petdog/

发布流程：推送 main → Actions 构建 dist 并更新 site 分支 → ECS 专属 systemd timer 每约 3 分钟检查并发布。

首次接入 ECS 需要执行一次性安装，详见 [部署与发布方案](docs/DEPLOYMENT.md)。当前页面是部署占位预览，账号、云端存档和宠物互动 API 尚未实现。

## 本地开发

项目初始化完成后，前后端分别安装依赖并启动。具体命令以各自目录的 package.json 为准。

## 部署

- 前端计划部署在 Game-Portal 的 /games/petdog/。
- API 计划通过同域 /pet-api/ 路径反向代理到 ECS 上的独立 Node.js 服务。
- 前端静态发布沿用 Game-Portal 的 Vite 静态站点流程。
- 后端使用独立的构建、发布、systemd 服务和健康检查流程。

当前仓库处于项目初始化阶段，部署配置以部署与发布方案为准。
