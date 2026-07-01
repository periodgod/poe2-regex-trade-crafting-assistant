# v1.6.4 做装通货与亵渎逻辑审计

本文件对应 `data-v2/currencies/core.json`、`data-v2/omens/core.json` 与 `src/currency-state-machine.js`。自动测试会为全部 29 条 `ready` 规则创建符合限制的代表物品并实际执行一次，避免出现“目录里有、状态机不能运行”的假实现。

## 29 条可执行通货/骨材

| ID | 中文名 | 类别 | 核心限制 | 状态 |
|---|---|---|---|---|
| `transmute` | 蜕变石 | 新增 | 输入 普通；结果 魔法；至少 0 条；至多 0 条；不可腐化/镜像 | ready |
| `greater_transmute` | 高阶蜕变石 | 新增 | 输入 普通；结果 魔法；至少 0 条；至多 0 条；新增词缀等级≥44；不可腐化/镜像 | ready |
| `perfect_transmute` | 完美蜕变石 | 新增 | 输入 普通；结果 魔法；至少 0 条；至多 0 条；新增词缀等级≥70；不可腐化/镜像 | ready |
| `augment` | 增幅石 | 新增 | 输入 魔法；结果 魔法；至少 1 条；至多 1 条；不可腐化/镜像 | ready |
| `greater_augment` | 高阶增幅石 | 新增 | 输入 魔法；结果 魔法；至少 1 条；至多 1 条；新增词缀等级≥44；不可腐化/镜像 | ready |
| `perfect_augment` | 完美增幅石 | 新增 | 输入 魔法；结果 魔法；至少 1 条；至多 1 条；新增词缀等级≥70；不可腐化/镜像 | ready |
| `regal` | 富豪石 | 新增 | 输入 魔法；结果 稀有；至少 1 条；至多 2 条；不可腐化/镜像 | ready |
| `greater_regal` | 高阶富豪石 | 新增 | 输入 魔法；结果 稀有；至少 1 条；至多 2 条；新增词缀等级≥35；不可腐化/镜像 | ready |
| `perfect_regal` | 完美富豪石 | 新增 | 输入 魔法；结果 稀有；至少 1 条；至多 2 条；新增词缀等级≥50；不可腐化/镜像 | ready |
| `alchemy` | 点金石 | 重铸 | 输入 普通/魔法；结果 稀有；不可腐化/镜像 | ready |
| `exalt` | 崇高石 | 新增 | 输入 稀有；结果 稀有；至多 5 条；不可腐化/镜像 | ready |
| `greater_exalt` | 高阶崇高石 | 新增 | 输入 稀有；结果 稀有；至多 5 条；新增词缀等级≥35；不可腐化/镜像 | ready |
| `perfect_exalt` | 完美崇高石 | 新增 | 输入 稀有；结果 稀有；至多 5 条；新增词缀等级≥50；不可腐化/镜像 | ready |
| `annul` | 剥离石 | 移除 | 输入 魔法/稀有；至少 1 条；不可腐化/镜像 | ready |
| `chaos` | 混沌石 | 替换 | 输入 稀有；至少 1 条；不可腐化/镜像 | ready |
| `greater_chaos` | 高阶混沌石 | 替换 | 输入 稀有；至少 1 条；新增词缀等级≥35；不可腐化/镜像 | ready |
| `perfect_chaos` | 完美混沌石 | 替换 | 输入 稀有；至少 1 条；新增词缀等级≥50；不可腐化/镜像 | ready |
| `fracturing` | 破溃宝珠 | 破裂 | 输入 稀有；至少 4 条；不能已有破裂；不可腐化/镜像 | ready |
| `gnawed_collarbone` | 啃噬锁骨 | 亵渎 | 输入 稀有；物等≤64；底材 jewellery；不可腐化/镜像 | ready |
| `gnawed_jawbone` | 啃噬颚骨 | 亵渎 | 输入 稀有；物等≤64；底材 weapon/quiver；不可腐化/镜像 | ready |
| `gnawed_rib` | 啃噬肋骨 | 亵渎 | 输入 稀有；物等≤64；底材 armour；不可腐化/镜像 | ready |
| `preserved_collarbone` | 保存完好的锁骨 | 亵渎 | 输入 稀有；底材 jewellery；不可腐化/镜像 | ready |
| `preserved_jawbone` | 保存完好的颚骨 | 亵渎 | 输入 稀有；底材 weapon/quiver；不可腐化/镜像 | ready |
| `preserved_rib` | 保存完好的肋骨 | 亵渎 | 输入 稀有；底材 armour；不可腐化/镜像 | ready |
| `preserved_cranium` | 保存完好的颅骨 | 亵渎 | 输入 稀有；底材 jewel；不可腐化/镜像 | ready |
| `preserved_vertebrae` | 保存完好的脊椎骨 | 亵渎 | 输入 稀有；底材 waystone；不可腐化/镜像 | ready |
| `ancient_collarbone` | 远古锁骨 | 亵渎 | 输入 稀有；新增词缀等级≥40；底材 jewellery；不可腐化/镜像 | ready |
| `ancient_jawbone` | 远古颚骨 | 亵渎 | 输入 稀有；新增词缀等级≥40；底材 weapon/quiver；不可腐化/镜像 | ready |
| `ancient_rib` | 远古肋骨 | 亵渎 | 输入 稀有；新增词缀等级≥40；底材 armour；不可腐化/镜像 | ready |

## 17 种预兆

| ID | 中文名 | 触发 | 状态机效果 |
|---|---|---|---|
| `omen_sinistral_exaltation` | 左旋崇高预兆 | `exalt, greater_exalt, perfect_exalt` | `{"forceSide":"prefix"}` |
| `omen_dextral_exaltation` | 右旋崇高预兆 | `exalt, greater_exalt, perfect_exalt` | `{"forceSide":"suffix"}` |
| `omen_greater_exaltation` | 高阶崇高预兆 | `exalt, greater_exalt, perfect_exalt` | `{"addCountOverride":2}` |
| `omen_whittling` | 削切预兆 | `chaos, greater_chaos, perfect_chaos` | `{"removeRule":"lowest_level"}` |
| `omen_abyssal_echoes` | 深渊回响预兆 | `reveal_desecrated` | `{"allowRerollOnce":true}` |
| `omen_dextral_necromancy` | 右旋死灵预兆 | `desecrate` | `{"forceSide":"suffix"}` |
| `omen_sinistral_necromancy` | 左旋死灵预兆 | `desecrate` | `{"forceSide":"prefix"}` |
| `omen_light` | 光明预兆 | `annul` | `{"removeSource":"desecrated"}` |
| `omen_putrefaction` | 腐败预兆 | `desecrate` | `{"replaceAllWithUnrevealed":true,"maxUnrevealed":6,"excludeExclusiveDesecrated":true,"disableMinimumModifierLevel":true}` |
| `omen_blackblooded` | 黑血预兆 | `desecrate` | `{"guaranteedTag":"kurgal_mod","allowedBaseTags":["weapon","jewellery"],"blockedTags":["amanamu_mod","ulaman_mod"],"disableMinimumModifierLevel":true}` |
| `omen_liege` | 领主预兆 | `desecrate` | `{"guaranteedTag":"amanamu_mod","allowedBaseTags":["weapon","jewellery"],"blockedTags":["kurgal_mod","ulaman_mod"],"disableMinimumModifierLevel":true}` |
| `omen_sovereign` | 君王预兆 | `desecrate` | `{"guaranteedTag":"ulaman_mod","allowedBaseTags":["weapon","jewellery"],"blockedTags":["amanamu_mod","kurgal_mod"],"disableMinimumModifierLevel":true}` |
| `omen_sinistral_annulment` | 左旋剥离预兆 | `annul` | `{"removeSide":"prefix"}` |
| `omen_dextral_annulment` | 右旋剥离预兆 | `annul` | `{"removeSide":"suffix"}` |
| `omen_sinistral_erasure` | 左旋抹除预兆 | `chaos, greater_chaos, perfect_chaos` | `{"removeSide":"prefix"}` |
| `omen_dextral_erasure` | 右旋抹除预兆 | `chaos, greater_chaos, perfect_chaos` | `{"removeSide":"suffix"}` |
| `omen_catalysing_exaltation` | 催化崇高预兆 | `exalt, greater_exalt, perfect_exalt` | `{"consumeCatalystQualityForWeight":true}` |

## 动态概率检查

- 每次操作按当前精确底材 ID、物品等级、前后缀空位、现有词缀家族、来源池和预兆重新生成候选事件。
- 普通通货只读取 `normal` 池；亵渎揭示按规则读取 `normal + desecrated`，精髓和其他特殊来源不会误混入。
- 单条新增按当前总权重精确枚举；混沌、点金、多条新增、破裂与亵渎使用固定种子的蒙特卡洛预览。
- 催化崇高预兆按品质与标签改变候选权重，执行后消耗催化品质；界面显示原始权重、倍率和最终权重。
- 高阶/完美通货最低词缀等级按词缀家族回退；没有达标 T 级时保留该家族在当前物等可用的最高等级，而不是错误删除整个家族。
- 高阶崇高预兆与左旋/右旋预兆叠加时，会预先检查对应一侧是否有两个空位；不足时在执行前阻止。

## 亵渎检查

- 11 种骨材的底材类别、稀有度、物等和腐化/镜像限制均由状态机检查。
- 满词缀物品随机移除可移除词缀，未揭示占位继承该词缀的前/后缀；非满词缀物品按当前两侧揭示池总权重动态选择方向。
- 揭示最多提供 3 个不同 `modifierId`，不会把同一词缀的不同 T 级重复展示。
- 远古骨材、三类巫妖、腐败预兆、光明预兆、深渊回响一次重骰及保存完好的脊椎骨/路石限制均有回归测试。
- 特殊唯一装备的多次亵渎例外没有混入普通稀有底材状态机；界面不会为缺少可靠规则的唯一物品伪造概率。

## 规则目录边界

`data-catalog` 共收录 78 项通货资料。当前 29 项是具有可验证显式词缀状态转移、并已接入严格模拟器的通货/骨材；品质、宝石孔、机会石、瓦尔宝珠、镜像等其余条目保留目标类型与使用限制目录，但不会在缺少完整物品域或结果分布时伪装成可执行随机模拟。
