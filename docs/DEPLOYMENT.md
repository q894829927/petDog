# 倩岚汪 — 部署与发布方案

- 文档版本：0.2
- ECS 已启用前端自动发布和独立 API 服务，HTTPS 健康检查已通过。
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

### 2.1 当前前端接入状态

仓库已包含前端 Vite 构建和 GitHub Actions 发布工作流。构建输出为根目录 dist，Vite base 固定为 /games/petdog/。工作流只发布静态产物，不包含后端源码、数据库或环境配置。

发布工作流为至少 1 KB 的 JS、CSS 和 GLB 生成并校验同名 `.gz`，原文件一同发布。ECS 的 `/etc/nginx/snippets/game-portal-managed-petdog.conf` 在 `location ^~ /games/petdog/` 内配置 `gzip_static on;` 和 `gzip_vary on;`。重新安装该站点路由时也须添加这两项，再执行 `nginx -t` 与 `systemctl reload nginx`。验收时分别带 `Accept-Encoding: gzip` 和 `Accept-Encoding: identity` 请求当前版本的同一个资源，检查前者返回 `Content-Encoding: gzip` 和 `Vary: Accept-Encoding`，且解压后与后者一致。

首次在 ECS 安装：

```bash
cd /root/Game-Portal
git status --short
git fetch origin main
git merge --ff-only FETCH_HEAD
bash -n scripts/install-managed-static-ecs.sh
bash scripts/install-managed-static-ecs.sh \
  --slug petdog \
  --repo q894829927/petDog
```

执行前，确认 petDog 仓库的 GitHub Actions 中 **Publish managed static site** 已成功，并已生成 site 分支。安装器会检查现有门户、游戏健康状态和 Nginx 路由冲突；预检失败时停止并根据报错排查。

若 ECS 无法通过 HTTPS 访问 GitHub，可为 petdog 单独配置只读 Deploy Key：

```bash
cd /root/Game-Portal
bash scripts/provision-managed-ssh-ecs.sh \
  --slug petdog \
  --repo q894829927/petDog
```

将脚本输出的公钥添加到 petDog 仓库 Settings → Deploy keys，保持只读，不勾选 Allow write access，然后重新执行安装器。私钥只保留在 ECS。

安装完成后检查：

```bash
systemctl is-enabled portal-site-petdog.timer
systemctl is-active portal-site-petdog.timer
systemctl start portal-site-petdog.service
journalctl -u portal-site-petdog.service -n 60 --no-pager
readlink -f /var/www/game-portal/managed-sites/petdog/current
cat /var/www/game-portal/managed-sites/petdog/current/.source-sha
curl -fsS https://47.119.122.133/games/petdog/ -o /dev/null
```

只有 timer 已启用、服务日志显示 SUCCESS、线上页面可访问且发布 SHA 与 main 对应提交一致，前端自动部署才算完成。

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

### 3.1 API 首次安装

1. 从 [Test and package PetDog API](https://github.com/q894829927/petDog/actions/workflows/build-api.yml) 下载目标提交的发布包。核对包内 `.source-sha`，解包到 `/opt/petdog-api/releases/<commit-sha>/`，使用 Node.js 22.18+ 执行 `npm ci --omit=dev`。
2. 创建 `petdog` 服务账号并将 `/opt/petdog-api/current` 指向该发布目录。创建权限为 0600 的 `/etc/petdog/api.env`，写入 `PETDOG_DB=/var/lib/petdog/petdog.sqlite` 和 `PETDOG_ORIGIN=https://47.119.122.133`。受控试玩期间，可设置 `PETDOG_ALLOW_REGISTER=1` 开放注册。
3. 安装发布包内的 `deploy/petdog-api.service`，核对 `ExecStart` 中的 Node.js 路径。运行 `systemctl daemon-reload` 和 `systemctl enable --now petdog-api.service`。启动时会执行版本化迁移，升级已有数据库前先备份。
4. 在现有 HTTPS server 块引入 `deploy/petdog-api.nginx.conf` 的内容。运行 `nginx -t`，通过后重载 Nginx。
5. 检查 `/pet-api/healthz` 是否返回 `{"ok":true}`，再用两个独立会话验证登录同一账号后能看到同一份宠物存档。

首次上线的试玩注册由 HTTPS 站点限制来源。登录和已有存档可在不同设备使用。

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

- /pet-api/ → http://127.0.0.1:3180，保留原请求路径。

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

- [x] 前端 Vite 基础工程与静态发布工作流已提交。
- [x] ECS 前端站点首次安装、timer 启用与线上验收。
- [x] API 构建、测试和 release 工作流。
- [ ] ECS API 安装器与受控发布器。
- [x] petdog-api.service。
- [ ] API 自动发布 timer。
- [x] Nginx /pet-api/ 反向代理。
- [ ] 数据库初始化、迁移和自动备份。
- [ ] HTTPS 下 Cookie 登录与跨设备验证。
- [ ] API 失败回滚与数据库恢复演练。
