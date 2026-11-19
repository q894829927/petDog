# 倩岚汪 — 技术设计文档

- 文档版本：0.1
- 状态：初始架构
- 目标：支持 3D 宠物互动、账号系统、跨设备云端存档和按现实时间结算的宠物状态

## 当前 UI 设计基线

2026-11 确定 [Warm Flat 全屏 HUD 规范](UI_DESIGN_BASELINE.md)。当前前端已实现 R3F 房间、Akita 骨骼动画、交互工具与低频 Zustand UI 状态。动画通过 `useFrame` 更新。服务端 API 和真实存档待实现，HUD 显示演示数值。

## 1. 总体架构

采用前后端分离的单仓库结构。前端是静态 Web 应用，后端是独立 Node.js 服务，数据库存放在 ECS 的持久化目录。

浏览器
  ├── Vite + React + Three.js
  └── 同源请求 /pet-api/v1/*
          |
          v
      Nginx 反向代理
          |
          v
      Fastify API（127.0.0.1:3180）
          |
          v
      SQLite（持久化文件）

前端部署在 Game-Portal 的 /games/petdog/。API 使用同域 /pet-api/ 路径，避免跨域 Cookie 和 CORS 配置复杂度。

## 2. 技术选型

### 前端

- Vite：开发服务器与生产构建。
- React + TypeScript：界面和应用结构。
- Three.js：3D 渲染基础。
- React Three Fiber：在 React 中组织 3D 场景。
- Drei：加载 GLB、动画和常用 3D 辅助组件。
- Zustand：本地交互状态、场景状态和 UI 状态。
- TanStack Query：服务端数据获取、缓存和失效刷新。
- Zod：共享请求与响应结构校验。

### 后端

- Node.js LTS + TypeScript。
- Fastify：HTTP API。
- SQLite：单机持久化数据库。
- Drizzle ORM：Schema、查询和迁移。
- better-sqlite3：SQLite 驱动。
- Argon2id：密码哈希。
- Zod：输入验证。
- Vitest：单元与集成测试。

SQLite 适合当前单服、低频宠物互动和读多写少的规模。数据库文件放在仓库之外，使用 WAL 模式、短事务和备份策略。未来需要多实例部署或高并发写入时，再迁移 PostgreSQL。

## 3. 仓库结构

建议采用 npm workspaces：

- apps/web：React + Three.js 前端。
- apps/api：Fastify 后端。
- packages/shared：前后端共用的类型、Schema 和常量。
- docs：产品、技术、部署与验收文档。
- .github/workflows：前端发布和后端 CI 工作流。

前端构建输出统一为仓库根目录 dist，以兼容 Game-Portal 的静态 Vite 发布流程。后端构建输出位于 apps/api/dist。

## 4. 前端模块

### 4.1 场景层

- PetRoom：房间场景与灯光。
- PetModel：柴犬 GLB 模型。
- PetAnimator：动画状态与动画混合。
- PetNavigation：房间内有限区域移动。
- InteractionRaycaster：鼠标与触摸命中检测。
- CameraController：固定观察视角和有限镜头调整。

### 4.2 宠物行为表现

前端负责把服务端状态和当前交互转化为实时画面：

- 服务端状态决定宠物需求、心情和可执行行为。
- 本地行为控制器负责短时动画衔接、路径插值和待机动作。
- 动画播放完成、转场和动作打断由本地表现层管理。
- 客户端可以预测动画反馈，但不能自行确认饱腹、物品数量或亲密度等持久数据。

### 4.3 UI 层

- Auth：注册、登录。
- PetHUD：名字、年龄、状态。
- InteractionBar：抚摸、呼唤、喂食、喝水、玩耍、梳毛。
- Inventory：食物和玩具。
- PetProfile：性格、年龄、亲密度。
- SyncIndicator：保存中、已同步、同步失败。

## 5. 后端模块

- auth：注册、登录、退出、当前会话。
- pet：宠物创建、档案、状态读取。
- simulation：根据服务器时间结算自然变化。
- interaction：处理抚摸、喂食、喝水、玩耍和清洁。
- inventory：物品数量与消耗。
- persistence：数据库访问和事务。
- health：服务健康检查。

业务模块不直接读取客户端时间。所有影响持久数据的操作都通过服务端事务执行。

## 6. 数据模型

### users

- id：主键。
- email：唯一登录邮箱。
- password_hash：Argon2id 哈希。
- created_at：创建时间。
- email_verified_at：邮箱验证时间，可空。

### sessions

- id：主键。
- user_id：所属用户。
- token_hash：Session 随机令牌的哈希值。
- expires_at：过期时间。
- created_at：创建时间。
- last_used_at：最近使用时间。

数据库只保存 Session 令牌哈希，不保存浏览器 Cookie 中的原始令牌。

### pets

- id：主键。
- user_id：唯一外键，一个账号首版只拥有一只宠物。
- name：宠物名字。
- species：首版固定为 shiba_inu。
- personality：性格配置。
- adopted_at：领养时间。
- hunger：饱腹值。
- hydration：水分值。
- energy：精力值。
- cleanliness：清洁度。
- happiness：心情值。
- affection：亲密度。
- sleep_state：睡眠状态。
- last_simulated_at：上次结算时间。
- version：乐观并发版本号。
- created_at、updated_at：创建和更新时间。

### pet_actions

- id：主键。
- pet_id：所属宠物。
- request_id：客户端生成的幂等请求 ID，对宠物唯一。
- action_type：互动类型。
- payload：必要的动作参数。
- created_at：服务端记录时间。

互动日志用于幂等处理、排查问题和后续行为统计，不记录不必要的个人信息。

## 7. 宠物时间模拟

### 7.1 结算原则

每只宠物记录 last_simulated_at。读取宠物或执行互动时：

1. 开启数据库写事务。
2. 锁定或保护当前宠物记录，读取最新状态。
3. 使用服务端当前 UTC 时间减去 last_simulated_at，得到 elapsedSeconds。
4. 根据经过时间、睡眠状态和性格参数结算需求变化。
5. 将数值限制在 0—100。
6. 更新 last_simulated_at、version 和 updated_at。
7. 提交事务并返回权威状态。

SQLite 使用短写事务，例如 BEGIN IMMEDIATE，避免两个设备同时结算同一只宠物时发生丢失更新。

### 7.2 状态规则

- 饱腹和水分随时间下降。
- 清洁度缓慢下降。
- 清醒时精力下降，睡眠时精力恢复。
- 心情受需求状态和互动影响。
- 亲密度通过有效的正向互动增加，不因离线时间下降。
- 年龄通过 adopted_at 与服务端当前时间计算。
- 所有状态值限制在 0—100。
- 不设计死亡或永久损失。

具体速率集中定义在 simulation 配置中，使用固定时间步或解析式计算，避免按每秒循环更新数据库。

### 7.3 交互结算

互动请求必须先结算自然变化，再校验动作条件，最后应用动作效果并保存。

例如喂食：
1. 结算离线和当前自然变化。
2. 检查宠物是否存在、物品是否充足、动作是否有效。
3. 扣除食物数量。
4. 恢复饱腹值并更新心情。
5. 写入 pet_actions。
6. 更新宠物版本并提交。
7. 返回最新宠物状态和物品数量。

同一个 request_id 重试时返回第一次执行结果，不再次扣除物品或增加属性。

## 8. 并发与跨设备同步

- 所有设备访问同一服务端宠物记录。
- 每次成功写入使 version 加一。
- 互动请求携带 expectedVersion 和 requestId。
- 版本冲突时服务端返回最新状态，客户端刷新后再决定是否重试。
- 前端在页面恢复焦点时重新获取宠物状态。
- 游戏运行期间以 30—60 秒低频刷新作为兜底；互动完成后立即更新。
- 首版不使用 WebSocket。只有需要实时双设备观战或即时同步时再引入。

## 9. API 设计

统一前缀：/pet-api/v1

### 认证

- POST /auth/register：注册。
- POST /auth/login：登录。
- POST /auth/logout：退出。
- GET /auth/me：获取当前用户。

### 宠物

- POST /pet：首次创建宠物。
- GET /pet：获取并结算宠物状态。
- PATCH /pet/profile：修改允许编辑的档案字段。
- POST /pet/actions：提交互动动作。

互动请求示例字段：

- requestId：幂等请求 ID。
- expectedVersion：客户端已知宠物版本。
- action：pet、feed、drink、play、brush、sleep、wake、call。
- payload：动作所需参数。

服务端返回宠物完整快照、物品变化和新版本号。

### 健康检查

- GET /healthz：返回服务健康状态，不暴露数据库凭据、路径和内部环境变量。

## 10. 身份认证与安全

- 密码使用 Argon2id 哈希，不保存明文密码。
- Session 使用密码学安全随机数生成，数据库只保存令牌哈希。
- Cookie 使用 HttpOnly、Secure、SameSite=Lax。
- 修改数据的请求校验 Origin，并限制请求来源。
- 登录和注册接口增加速率限制。
- 所有输入通过 Schema 校验，数据库查询使用参数化接口。
- 生产环境密钥放在 ECS 的独立环境文件中，不进入 Git。
- 账号数据、宠物存档和数据库备份不进入静态 dist。
- API 仅监听 127.0.0.1，不直接暴露公网端口。

邮箱验证、找回密码和邮件服务在正式公开注册前补齐；开发阶段可以使用受控的测试账号流程。

## 11. 3D 资源与动画要求

首发柴犬需要一套带骨骼的 GLB 模型。模型至少提供：

- Idle：自然待机。
- Walk：行走。
- Run：奔跑。
- Sit：坐下。
- Lie：趴下。
- Sleep：睡眠。
- LookAround：观察。
- Sniff：嗅闻。
- Eat：进食。
- Drink：喝水。
- Happy：开心反应。
- TailWag：摇尾。
- PetHead：头部被抚摸时的反应。
- PetBack：背部被抚摸时的反应。
- Bark：吠叫或回应。

动画应允许合理混合，例如尾巴动作与待机动作叠加。若模型没有独立表情骨骼，首版使用头部、耳朵、身体姿态和音效表达情绪。

模型交付需要检查骨骼命名、根骨骼方向、动作循环、动画时长、材质贴图和 GLB 文件体积。

### 11.1 Akita 原型

默认的「标准」画质使用 Dogs_Big_pack 的 `Mesh_Akita` 和材质 `M_Akita_color`。「省电」画质使用 `Mesh_Akita_LowPoly` 和材质 `M_Akita_color_M`。两种模型均通过 Unreal glTF Exporter 转为内嵌贴图的 GLB，共用同一组骨骼动画。Web 使用 `GLTFLoader` 按画质加载模型，通过 `AnimationMixer` 混合待机和互动动作。

- `Idle_1` 用于待机，`Idle_2` 用于呼唤，`Idle_3` 用于抚摸与梳毛。
- 玩球时先规划追球和返回路线。球升到团子上方后跨过房间，落在有空间叼球的位置。球落地后用 `Run_F_IP` 跑过去，按对应的根运动步幅移动，靠近球时减速步行。低头和抬头复用 `EatDrink_start`、`EatDrink_end`，在嘴碰到球的高度衔接，叼住后球随头部骨骼移动。返回使用步行动画，团子会在房间前侧的投球点放下球。
- 往返两程都用犬身的安全距离检查碗和狗窝。直线被挡住时，可经地毯中央转向。抚摸或呼唤等操作可以打断追球。空中的球会沿原轨迹落地，叼着的球在当前位置放下。
- 放入狗粮或清水后，团子绕开球和狗窝，走到浅碗前对准碗再低头。`Eat_loop` 和 `Drink_loop` 各自与 `EatDrink_start`、`EatDrink_end` 合成一段动作，碗内食物和水量随播放进度减少。
- 自主活动会在地毯内随机选取落脚点。选点时为身体留出空间，并检查整段路线能否避开碗、狗窝和球。步行使用 `Walk_F_IP`，按对应根运动 `Walk_F_RM` 的步幅移动。到达后可以站立待机，也可以播放由 `Sitting_start`、`Sitting_loop` 和 `Sitting_end` 合成的坐下休息动作。
- 球挡住路线时宠物会停下并重新选点。玩家互动会中断走动或休息，动画回应结束后先待机，再选取新的落脚点。

## 12. 测试策略

- 单元测试：时间结算、状态边界、性格参数、互动效果。
- 数据库集成测试：注册登录、事务、幂等、并发版本。
- API 测试：权限隔离、输入校验、错误响应。
- 前端测试：互动工具、状态展示、同步状态。
- Playwright E2E：注册、领养、互动、退出、另一设备重新登录。
- 时间测试使用可注入的服务端 Clock，不修改操作系统时间。

关键验收场景：
- 同一账号两个客户端同时喂食，物品不能重复扣除。
- 页面离线数小时后，状态按服务端时间结算。
- 客户端修改系统时间，结算结果不变。
- API 失败时不显示虚假的已保存状态。
- 一个用户无法读取或修改另一个用户的宠物。

## 13. 可观测性与备份

- 应用日志输出到 journald。
- 日志包含 requestId、路由、耗时和错误类别，不记录密码、Cookie 或原始 Session。
- SQLite 使用 WAL。
- 备份使用 SQLite 在线备份机制或一致性快照，不直接复制正在写入的数据库主文件。
- 备份放在独立目录，设置保留周期，并定期进行恢复演练。
