# v1.6.4 严格数据来源与完整性

## 抓取文件

更新器固定抓取 `summary.json`、`bases.json`、`base_items.json`、`modifiers.json`、`modifier_types.json`、`modifier_groups.json`、`modifier_tiers.json`、`lang_base.json` 和 `lang_mod.json`。更新时先解析 `main` 的当前提交 SHA，并让九个文件全部从同一提交下载；若当前提交整组下载失败，则整组回退到已核验提交，绝不逐文件混合版本。每个提交依次尝试 GitHub Raw、GitHub Raw 跳转、cdn.jsdelivr、fastly.jsdelivr 与 testingcf.jsdelivr。

## 完整性定义

规范化主键为 `(base_id, modifier_id)`。每一个来源底材生成独立池，合法空池也必须保留，因此不会再出现来源有 80 个底材、输出只有 79 个池的误报。完整性校验包括：

- `summary.json` 数量与九个原始文件一致；
- 底材、具体基底和词缀 ID 唯一；
- 所有具体基底引用已建立的来源底材；
- 所有 T 级只引用已知底材与词缀；
- 前缀/后缀、物等、权重和外部 T 级 ID 均合法；
- 每个来源底材都有池文件；
- 普通与亵渎池均存在正权重记录；
- 原始文件完整保存在 `raw-source/`，哈希记录在 `source-metadata.json`。

内置回退提交的来源清单为 80 个底材、1775 个具体基底、1318 个词缀、52 个词缀类型、19023 条来源 T 级记录、80 条底材名称映射和 1318 条词缀名称映射。在线更新优先使用当前主分支，实际数量可增加。

## 词缀来源隔离

- Base → `normal`
- Desecrated → `desecrated`
- Essence → `essence`
- 其他组 → `special`

普通通货只抽取 `normal`。亵渎揭示根据规则组合 `normal` 与 `desecrated`。零权重 T 级保留供审计，但不会进入随机事件。

## 权重说明

Craft of Exile 的 PoE2 权重是社区推导数据，不应描述为游戏客户端直接导出的官方权重。每次状态变化都会重新过滤候选并归一化权重，但结果准确度仍受公开数据源准确度限制。
