# slint-bangumi

这是一个基于 Rust + Slint 的轻量本地看番管理工具骨架。

当前阶段实现媒体库应用骨架和核心数据流：

- 本地媒体库路径配置和递归扫描
- SQLite 媒体条目索引
- 重复扫描时识别新增、修改、恢复和删除
- 观看进度读取、写入、清空测试接口
- dandanplay 文件识别与弹幕数量加载
- Bangumi 元数据搜索、候选保存、确认绑定
- 番剧详情、海报/头图缓存和本地图片显示
- 唤起系统默认播放器播放本地媒体
- Home、Library、Settings 桌面应用主框架和内部匹配视图
- Slint callback 直连 Rust service 层
- 后台扫描和元数据任务通过事件通知 UI

## 运行

```bash
cargo run --release
```

首次启动会自动生成 `config.toml`，默认数据库路径是 `data/slint-bangumi.sqlite3`。

Bangumi 使用官方公共 API，默认可以匿名访问，不需要 token。`access_token` 是可选项；如果填写，程序会发送 `Authorization: Bearer <token>`。设置页只显示 `anonymous` 或 `token configured`，不会显示 token 明文。

`dandanplay` 相关字段只保留空占位，不包含真实密钥。

## Bangumi 配置

```toml
[bangumi]
enabled = true
base_url = "https://api.bgm.tv"
access_token = ""
user_agent = "slint-bangumi/0.1.0"
request_timeout_secs = 20
auto_match = true
cache_images = true
```

官方 API 文档见 <https://bangumi.github.io/api/>。

## 后端运行约定

启动顺序：

1. 读取或生成 `config.toml`，初始化 SQLite schema 和轻量迁移。
2. 创建 `MediaService`、`DanmakuService`、`MetadataService`、`WatchHistoryService`。
3. UI 首屏只读取本地缓存数据：媒体卡片、统计、候选和图片路径，不等待网络。
4. 扫描、dandanplay 识别、Bangumi 搜索、条目详情、章节列表和图片缓存全部在后台线程执行。
5. 后台任务通过 channel 发出 `AppEvent`，UI 只在 `slint::invoke_from_event_loop` 内刷新模型。

扫描和匹配顺序：

- Scan：递归扫描配置目录，识别视频文件，必要时只哈希文件前 16 MiB，写入新增、修改、恢复、删除状态。
- Match：未匹配且未忽略的媒体进入匹配队列。优先用 dandanplay 文件识别结果生成 Bangumi 搜索关键词，保存候选但不强行覆盖人工选择。
- Confirm：确认候选后拉取 Bangumi 条目详情和 `/v0/episodes` 章节列表，绑定本地文件到推断集数，并缓存 poster / hero。
- Ignore：用户可以把媒体标记为忽略，后续 Match All 不再反复处理；手动 Rematch 会清除忽略状态。

性能约束：

- UI 线程不做文件遍历、哈希、网络请求或图片下载。
- 网络请求使用超时配置；失败只记录状态，不阻塞页面渲染。
- 同一 subject 的 poster / hero 只缓存一次，已存在文件不会重复下载。
- Library 和 Detail 始终先显示本地缓存、候选或占位内容，再由后台事件逐步更新。

## 模块结构

- `src/domain.rs`: 业务数据结构
- `src/config.rs`: `config.toml` 读取、生成和更新
- `src/repository.rs`: SQLite 初始化和数据访问
- `src/metadata/`: Bangumi Provider、图片缓存、匹配关键字处理
- `src/service.rs`: 媒体库、观看历史、元数据、dandanplay 弹幕服务和本地播放入口
- `src/task.rs`: 后台扫描、元数据匹配、图片缓存任务和事件
- `src/ui/bridge.rs`: Slint callback 与 service 层桥接
- `ui/main.slint`: Fluent / Material 3 混合风格媒体库界面
