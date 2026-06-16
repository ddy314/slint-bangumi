# slint-bangumi

这是一个基于 Rust + Slint 的轻量本地看番工具骨架。

当前阶段只实现后端核心和最小可测试前端：

- 本地媒体库路径配置和递归扫描
- SQLite 媒体条目索引
- 重复扫描时识别新增、修改、恢复和删除
- 观看进度读取、写入、清空测试接口
- 弹幕匹配接口占位和 mock 返回
- Slint callback 直连 Rust service 层
- 后台扫描线程通过事件通知 UI

## 运行

```bash
cargo run
```

首次启动会自动生成 `config.toml`，默认数据库路径是 `data/slint-bangumi.sqlite3`。`dandanplay` 相关字段只保留空占位，不包含真实密钥。

## 模块结构

- `src/domain.rs`: 业务数据结构
- `src/config.rs`: `config.toml` 读取、生成和更新
- `src/repository.rs`: SQLite 初始化和数据访问
- `src/service.rs`: 媒体库、观看历史、弹幕 mock 服务
- `src/task.rs`: 后台扫描任务和事件
- `src/ui/bridge.rs`: Slint callback 与 service 层桥接
- `ui/main.slint`: 最小测试界面
