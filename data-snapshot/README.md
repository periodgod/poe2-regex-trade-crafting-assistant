# 严格做装快照目录

初始发布包不内置远程大体积词缀快照。运行根目录的 `UPDATE_FULL_POE2_DATA.cmd` 后，本目录会生成：

- `by-base/index.json`
- `by-base/<底材池>.mods.json`
- `base-metadata.json`
- `base-items.json`
- `modifier-groups.json`
- `source-metadata.json`
- `raw-source/`（九个原始 JSON，含底材/词缀逐 ID 名称映射）
- 状态为 `ready` 且 `strictBasePools=true` 的 `manifest.json`

模拟器采用失败关闭策略：快照未下载、校验失败或某个底材池缺失时，不使用通用标签或演示数据代替。
