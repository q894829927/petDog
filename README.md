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
- [UI 设计基线（Warm Flat）](docs/UI_DESIGN_BASELINE.md)
- [技术设计文档](docs/TECHNICAL_DESIGN.md)
- [部署与发布方案](docs/DEPLOYMENT.md)
- [开发路线图](docs/ROADMAP.md)

## 技术栈

- 前端：Vite、React、TypeScript、Three.js、React Three Fiber、Zustand
- 后端：Node.js 22.18+、TypeScript、Fastify
- 数据库：SQLite、Node.js 参数化语句、版本化 SQL 迁移
- 认证：Argon2id、服务端 Session、HttpOnly Cookie
- 测试：Node.js 测试运行器、浏览器交互验证

## 当前部署状态

前端 Vite 项目已配置独立 GitHub Actions 发布工作流，目标地址：

- https://47.119.122.133/games/petdog/

发布流程：推送 main → Actions 构建 dist 并更新 site 分支 → ECS 专属 systemd timer 每约 3 分钟检查并发布。

前端静态站点已接入 ECS。账号和存档 API 通过独立工作流构建发布包，首次安装见 [部署与发布方案](docs/DEPLOYMENT.md#31-api-首次安装)。

## 本地开发

前端执行 `npm ci` 和 `npm run dev`，默认地址为 `http://127.0.0.1:5173/games/petdog/`。另开终端运行 API：

```sh
npm --prefix apps/api ci
npm --prefix apps/api run build
npm --prefix apps/api start
```

Vite 将同源 `/pet-api/` 请求转发到本地 API。点击顶部云图标可以注册、登录和领养。测试执行 `npm --prefix apps/api test`，静态站点构建执行 `npm run build`。

## 部署

- 前端部署在 Game-Portal 的 /games/petdog/。
- API 计划通过同域 /pet-api/ 路径反向代理到 ECS 上的独立 Node.js 服务。
- 前端静态发布沿用 Game-Portal 的 Vite 静态站点流程。
- 后端使用独立的构建、发布、systemd 服务和健康检查流程。

当前房间使用 Dogs_Big_pack 的 Akita（秋田犬）验证走动、吃喝、叼球、呼唤和抚摸、梳毛与休息。访客可用示例宠物试玩。连上账号 API 后，领养档案、宠物状态和互动进度由服务端保存。正式首发宠物规划为柴犬。
