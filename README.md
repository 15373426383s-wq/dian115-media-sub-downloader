# 媒体订阅分下载器（media-sub-downloader）

DIAN115 v3 第三方可信扩展。把 **DIAN115 原生媒体订阅** 按媒体类型自动分配到不同 PT 下载器：
**电影** 订阅 → 电影下载器（如 qBittorrent），**剧集** 订阅 → 剧集下载器（如另一个 qBittorrent）。

## 工作原理

DIAN115 原生订阅本身就会扫描 PT 站点、找到匹配资源后派发到下载器。订阅上自带一个
`pt_downloader` 字段（按**名称**指定下载器）。本插件只做一件事：保证每个订阅的
`pt_downloader` 与其类型匹配——

1. 页面读取宿主 `GET /api/pt/downloaders`，让你分别为"电影""剧集"选择下载器（存为 `dl_movie` / `dl_tv`）。
2. 页面读取 `GET /api/subscribe/pool/intents`，展示每个订阅：标题、类型、当前下载器、期望下载器、状态。
3. 后台任务由以下任一方式触发（三种都会跑同一套同步逻辑）：
   - **宿主事件 `subscribe_added`**：你在 DIAN115 新增订阅时即时触发（推荐，无需等待，避免新订阅先被默认下载器接走）；
   - **定时兜底**（`*/5 * * * *`，每 5 分钟）；
   - 页面「同步订阅下载器」按钮手动触发。
4. 同步逻辑：
   - 电影订阅（`media_type=movie`）→ 把 `pt_downloader` 设为 `dl_movie`；
   - 剧集订阅（`media_type=tv`）→ 把 `pt_downloader` 设为 `dl_tv`；
   - 已是目标值则跳过（幂等），未配置对应下载器的订阅跳过。
   - 写入走 `PATCH /api/subscribe/pool/intents/{id}/preferences`，body `{ "downloader": "<名称>" }`。
5. 之后由 DIAN115 原生流程负责扫描 PT 站点并把资源派发到对应下载器（插件不自行提交下载）。

> 为什么不再让插件自己扫描磁力并提交？因为原生订阅已经会派发下载，插件重复提交会导致重复下载。
> 本插件只负责"按类型把订阅指到正确的下载器"，分工清晰、幂等、无冗余。

## 复用接口（declared_usage）

- `GET /api/pt/downloaders` — 拉取可用下载器（取 `name` 作为标识）
- `GET /api/subscribe/pool/intents` — 读取原生订阅列表（含 `media_type` 与 `pt_downloader`）
- `PATCH /api/subscribe/pool/intents/{id}/preferences` — 写入订阅的 `pt_downloader`

## 安装

源码目录直接包含 `plugin.json`。在 DIAN115 插件中心以"源码目录"方式安装，或上传 `.dian115p` 包安装：
`目录` 指向本文件夹 → inspect → 确认 → 用返回 token 安装。
`requires.api` 为 `3.5`，宿主版本过低会拒绝安装。

## 配置

打开插件页面：
- 选「电影下载器」「剧集下载器」（来自宿主已配置的下载器列表，按名称匹配）；
- 点「保存下载器配置」；
- 点「刷新订阅」查看当前各订阅的下载器分配；
- 新增订阅时宿主会立即触发同步（`subscribe_added` 事件），一般无需手动操作；
- 也可点「同步订阅下载器」立即按类型写入；另有每 5 分钟定时兜底。

## 说明

- 配置（下载器选择、同步记录）仅存于插件 KV，不写入源码、不含任何账号密码或宿主地址。
- 同步是期望态对账（desired-state reconcile）：已正确的订阅跳过，因此可放心频繁运行。
- `recover` 在超时/中断后返回 `attention`，要求人工核对，禁止自动重发。
- 修改后使用 `conformance/project-check.mjs` 做结构校验，再重新打包安装（安装后改代码即停用）。
