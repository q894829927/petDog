# 倩岚汪 — 部署与发布方案

- 文档版本：0.1
- 当前状态：方案阶段，尚未在 ECS 安装
- 仓库：q894829927/petDog
- 前端路径：/games/petdog/
- API 路径：/pet-api/
- 目标服务器：现有 Game-Portal ECS

## 1. 部署边界

Game-Portal 当前的自动发布工具适用于公开静态 HTML 和 Vite 项目。它负责前端构建产物的 SHA 校验、原子发布和失败回滚，不负责 Node.js 后端、数据库或业务数据。

倩岚汪需要两条独立发布链路：

1. 前端：GitHub main → Actions 构建 dist → site 分支 → ECS managed static timer → /games/petdog/。
2. 后端：GitHub main → 后端 CI 与构建产物 → 受控 API release → ECS 专用部署器 → petdog-api.service。

两条链路使用同一仓库和源码提交，但部署状态、服务重启和回滚互相隔离。

## 2. 前端自动发布

沿用 Game-Portal 的静态 Vite 项目流程：

- 仓库：q894829927/petDog。
- slug：petdog。
- 页面路径：/games/petdog/。
- Vite base：/games/petdog/。
- 构建输出：仓库根目录 dist。
- GitHub Actions 构建成功后发布 site 分支。
- ECS 每约三分钟检查 main SHA、对应 Actions 成功状态和 site 来源 SHA。
- 新版本解包到独立 release 目录，校验后原子切换 current。
- 校验失败时恢复上一版本。

由于仓库已经创建，脚手架输出目录不能直接指向已有仓库目录。使用 Game-Portal 脚手架时应先生成到临时目录，再将所需配置合并到本仓库，保留 monorepo 的根 package.json、工作区和前端构建输出约定。

前端工作流必须在根目录执行 npm run build，并最终生成根目录 dist。不要让静态发布流程把后端源码、数据库或环境文件复制到 dist。

## 3. 后端独立服务

建议部署参数：

- systemd 服务：petdog-api.service。
- 监听地址：127.0.0.1:3180。
- API 公共路径：/pet-api/。
- 数据目录：/var/lib/petdog/。
- 数据库：/var/lib/petdog/petdog.sqlite。
- 发布目录：/opt/petdog-api/releases/<commit-sha>/。
- 当前版本：/opt/petdog-api/current。
- 环境配置：/etc/petdog/api.env，权限 0600。
- 服务账号：petdog，非登录系统用户。

Node 服务只监听本机回环地址。Nginx 负责把 /pet-api/ 反向代理到 127.0.0.1:3180。Cookie 在同一站点下工作，前端不需要开放宽泛 CORS。

## 4. 后端自动发布流程

后端不能直接套用静态站点安装器。需要新增独立的受控发布器：

1. GitHub Actions 对 API 代码执行类型检查、测试和生产构建。
2. 工作流为成功的源码 SHA 生成不可变 API release 包和来源清单。
3. ECS 定时检查目标 SHA 对应的 CI 状态和 release 来源。
4. 下载并校验包，解压到新的不可变 release 目录。
5. 使用 petdog 服务账号安装生产依赖或运行已构建产物。
6. 执行数据库迁移前创建一致性备份。
7. 运行向后兼容的数据库迁移。
8. 原子切换 current 并重启 petdog-api.service。
9. 检查 /pet-api/healthz 和核心 API。
10. 健康检查失败时恢复上一版代码并重启服务，保留数据库备份和迁移日志。

发布器以 root 身份安装和管理系统资源；应用进程以 petdog 用户运行。不要让 ECS 以 root 身份执行仓库中未经审查的任意脚本。

## 5. 数据库迁移约束

- 数据库文件位于仓库之外。
- 每次迁移使用版本化迁移文件。
- 先备份，再迁移。
- 迁移尽量采用新增字段、新表和双读写的兼容方式。
- 前端与 API 在短暂版本错位期间仍能工作。
- 破坏性字段删除分为独立发布阶段。
- 代码回滚不自动回滚数据库；需要单独评估迁移是否可逆。
- 定期验证备份可以恢复。

## 6. Nginx 路由

新增 API 路由：

- /pet-api/ → http://127.0.0.1:3180/

配置要求：
- 保留原有 Game-Portal、Rift、Tactics、Pinball 和 Our-Little-World 路由。
- 只新增倩岚汪专用 location 或 snippet。
- 保留原有 HTTPS 入口和证书配置。
- 不公开 3180 端口。
- 限制请求体大小和超时时间。
- 正确传递 Host、X-Forwarded-For、X-Forwarded-Proto。
- 对健康检查和认证 API 使用明确路由。

## 7. 部署顺序

首次部署顺序：

1. 完成本地前后端功能和测试。
2. 配置 GitHub Actions 前端构建与后端 CI。
3. 在 ECS 安装数据库目录、服务账号、环境文件和后端服务。
4. 配置 Nginx API 反向代理并验证 HTTPS。
5. 首次部署 API，完成数据库初始化和健康检查。
6. 部署前端到 /games/petdog/。
7. 验证注册、登录、领养、互动和跨设备同步。
8. 启用 API 与静态站点各自的定时发布任务。

日常发布时，先保证 API 向后兼容，再发布前端。两条定时任务不应通过覆盖同一目录或重启同一服务互相影响。

## 8. 运维检查

需要提供以下检查：

- petdog-api.service 是否 active。
- API healthz 是否返回成功。
- 前端 current 指向的 commit SHA。
- 后端 current 指向的 commit SHA。
- 两个部署 timer 是否 enabled 和 active。
- SQLite 文件大小、WAL 文件和磁盘空间。
- 最近一次数据库备份时间。
- 最近一次备份恢复演练结果。
- 最近一次部署日志和回滚记录。

## 9. 当前未完成事项

以下工作必须在实现阶段完成并在真实 ECS 验证后，才能标记为生产可用：

- [ ] 前端 Vite 工作区与静态发布工作流。
- [ ] API 构建、测试和 release 工作流。
- [ ] ECS API 安装器与受控发布器。
- [ ] petdog-api.service 和 timer。
- [ ] Nginx /pet-api/ 反向代理。
- [ ] 数据库初始化、迁移和自动备份。
- [ ] HTTPS 下 Cookie 登录与跨设备验证。
- [ ] API 失败回滚与数据库恢复演练。
