# 媒体订阅分下载器（media-sub-downloader）

DIAN115 v3 第三方可信扩展。按媒体类型把订阅资源分流到不同宿主下载器：
**电影** 提交到一个下载器（如 qBittorrent），**剧集** 提交到另一个（如 Transmission）。

## 工作原理

1. 页面读取宿主 `GET /api/pt/downloaders`，让你分别为"电影""剧集"选择下载器。
2. 维护**两组**订阅：**电影订阅** 与 **剧集订阅**（仅关键词 + 启用开关，无需单独选类型）。
3. 后台定时（`*/30 * * * *`）或手动触发扫描：
   - 对每个启用订阅，用 `GET /api/cache/magnet/changes`（API 3.5 增量接口）按关键词+时间游标续读；
   - 仅取 `link_type==='magnet'` 的候选（qBittorrent / Transmission 支持磁力；ED2K 跳过，不转交 115）；
   - 调用 `POST /api/pt/download`，传入 `downloader`（该类型对应下载器）与 `media_type`；
   - 增量基线（since/cursor）按订阅独立持久化，完整空结果也推进，错误/未读完保留原基线。
4. 任务级进度（`total/done/failed`）显示在宿主任务队列，结束发通知。

## 复用接口（declared_usage）

- `GET /api/pt/downloaders` — 拉取可用下载器
- `GET /api/cache/magnet/changes` — 增量磁力缓存搜索（API 3.5）
- `POST /api/pt/download` — 提交到指定下载器，`downloader` + `media_type`

## 安装

源码目录直接包含 `plugin.json`。在 DIAN115 插件中心以"源码目录"方式安装：
`目录` 指向本文件夹 → inspect → 确认 → 用返回 token 安装。
`requires.api` 为 `3.5`，宿主版本过低会拒绝安装。

## 配置

打开插件页面：
- 选「电影下载器」「剧集下载器」（来自宿主已配置的下载器列表）；
- 在「电影订阅」分组添加订阅（关键词 + 启用）；在「剧集订阅」分组添加订阅；
- 自动分流：电影订阅 → 电影下载器（media_type=movie），剧集订阅 → 剧集下载器（media_type=tv）；
- 点「保存配置」，再点「立即运行扫描」测试，或等定时任务。

## 说明

- 配置（下载器选择、订阅、增量基线）仅存于插件 KV，不写入源码、不含任何账号密码或宿主地址。
- 去重依赖宿主 `POST /api/pt/download` 返回的 `already_existed` 与增量基线，避免重复提交。
- `recover` 在超时/中断后返回 `attention`，要求人工核对远端，禁止自动重发。
- 修改后使用 `conformance/project-check.mjs` 做结构校验，再重新打包安装（安装后改代码即停用）。
