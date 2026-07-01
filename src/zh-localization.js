'use strict';

// PoE2 做装数据的简体中文显示层。
// 所有计算仍使用来源中的英文名称、底材 ID、词缀 ID、冲突组和权重；
// 本模块只生成中文展示文本，绝不以翻译结果参与概率计算。

const BASE_NAMES = Object.freeze({
  'Ring':'戒指','Amulet':'项链','Belt':'腰带','Quiver':'箭袋',
  'Shield (STR)':'盾牌（力量）','Shield (DEX)':'盾牌（敏捷）','Shield (INT)':'盾牌（智慧）',
  'Shield (STR/DEX)':'盾牌（力量/敏捷）','Shield (STR/INT)':'盾牌（力量/智慧）','Shield (DEX/INT)':'盾牌（敏捷/智慧）',
  'Claw':'爪','Dagger':'匕首','One Hand Sword':'单手剑','One Hand Axe':'单手斧','One Hand Mace':'单手锤',
  'Sceptre':'权杖','Wand':'魔杖','Bow':'弓','Staff':'法杖','Two Hand Sword':'双手剑','Two Hand Mace':'双手锤',
  'Two Hand Axe':'双手斧','Warstaff':'战杖','Quarterstaff':'长棍',
  'Ruby':'红玉珠宝','Emerald':'翠绿珠宝','Sapphire':'钴蓝珠宝',
  'Gloves (STR)':'手套（力量）','Gloves (DEX)':'手套（敏捷）','Gloves (INT)':'手套（智慧）',
  'Gloves (STR/DEX)':'手套（力量/敏捷）','Gloves (STR/INT)':'手套（力量/智慧）','Gloves (DEX/INT)':'手套（敏捷/智慧）',
  'Boots (STR)':'鞋子（力量）','Boots (DEX)':'鞋子（敏捷）','Boots (INT)':'鞋子（智慧）',
  'Boots (STR/DEX)':'鞋子（力量/敏捷）','Boots (STR/INT)':'鞋子（力量/智慧）','Boots (DEX/INT)':'鞋子（敏捷/智慧）',
  'Body Armour (STR)':'胸甲（力量）','Body Armour (DEX)':'胸甲（敏捷）','Body Armour (INT)':'胸甲（智慧）',
  'Body Armour (STR/DEX)':'胸甲（力量/敏捷）','Body Armour (STR/INT)':'胸甲（力量/智慧）','Body Armour (DEX/INT)':'胸甲（敏捷/智慧）',
  'Body Armour (STR/DEX/INT)':'胸甲（力量/敏捷/智慧）',
  'Helmet (STR)':'头盔（力量）','Helmet (DEX)':'头盔（敏捷）','Helmet (INT)':'头盔（智慧）',
  'Helmet (STR/DEX)':'头盔（力量/敏捷）','Helmet (STR/INT)':'头盔（力量/智慧）','Helmet (DEX/INT)':'头盔（敏捷/智慧）',
  'Life Flask':'生命药剂','Mana Flask':'魔力药剂','Spear':'长矛','Flail':'连枷',
  'Chaos Wand':'混沌魔杖','Physical Wand':'物理魔杖','Fire Wand':'火焰魔杖','Lightning Wand':'闪电魔杖','Ice Wand':'冰霜魔杖','Cold Wand':'冰霜魔杖',
  'Fire Staff':'火焰法杖','Ice Staff':'冰霜法杖','Cold Staff':'冰霜法杖','Lightning Staff':'闪电法杖','Chaos Staff':'混沌法杖','Physical Staff':'物理法杖',
  'Crossbow':'十字弩','Focus':'法器','Low Tier (1-5)':'低阶引路石（1—5阶）','Mid Tier (6-10)':'中阶引路石（6—10阶）',
  'Top Tier (11-15)':'高阶引路石（11—15阶）','Uber Tier':'终极阶引路石','Precursor Tablet':'先驱石板',
  'Breach Precursor Tablet':'裂隙先驱石板','Ritual Precursor Tablet':'祭祀先驱石板','Delirium Precursor Tablet':'惊悸迷雾先驱石板',
  'Expedition Precursor Tablet':'探险先驱石板','Overseer Precursor Tablet':'监工先驱石板','Abyss Precursor Tablet':'深渊先驱石板',
  'Irradiated Precursor Tablet':'辐照先驱石板','Temple Precursor Tablet':'神庙先驱石板','Charm':'护符','Talisman':'护身符','Grasping Mail':'攫取之铠'
});

const WORDS = Object.freeze({
  strength:'力量',dexterity:'敏捷',intelligence:'智慧',attribute:'属性',attributes:'属性',
  physical:'物理',fire:'火焰',cold:'冰霜',ice:'冰霜',lightning:'闪电',chaos:'混沌',elemental:'元素',
  damage:'伤害',resistance:'抗性',resistances:'抗性',maximum:'最大',minimum:'最低',life:'生命',mana:'魔力',
  energy:'能量',shield:'护盾',spirit:'精魂',armour:'护甲',armor:'护甲',evasion:'闪避',rating:'值',accuracy:'命中',
  stun:'晕眩',threshold:'阈值',attack:'攻击',attacks:'攻击',spell:'法术',spells:'法术',skill:'技能',skills:'技能',
  minion:'召唤生物',minions:'召唤生物',projectile:'投射物',projectiles:'投射物',melee:'近战',critical:'暴击',hit:'击中',hits:'击中',
  chance:'几率',bonus:'加成',speed:'速度',duration:'持续时间',magnitude:'强度',rate:'速率',recovery:'恢复',regeneration:'再生',
  flask:'药剂',flasks:'药剂',charm:'护符',charms:'护符',charge:'充能',charges:'充能',slot:'插槽',slots:'插槽',
  block:'格挡',rarity:'稀有度',quantity:'数量',items:'物品',item:'物品',found:'找到',gold:'金币',pack:'怪物群',size:'规模',
  freeze:'冻结',chill:'冰缓',shock:'感电',ignite:'点燃',poison:'中毒',bleeding:'流血',ailment:'异常状态',ailments:'异常状态',
  cooldown:'冷却',rage:'怒火',thorns:'荆棘',curse:'诅咒',curses:'诅咒',withered:'凋零',presence:'领域',area:'区域',effect:'效果',
  ring:'戒指',rings:'戒指',amulet:'项链',amulets:'项链',belt:'腰带',belts:'腰带',quiver:'箭袋',quivers:'箭袋',
  helmet:'头盔',helm:'头盔',gloves:'手套',gauntlets:'手套',boots:'鞋子',shoes:'鞋子',body:'胸甲',armour:'护甲',
  bow:'弓',bows:'弓',crossbow:'十字弩',crossbows:'十字弩',quarterstaff:'长棍',quarterstaves:'长棍',mace:'锤',maces:'锤',
  wand:'魔杖',wands:'魔杖',staff:'法杖',sceptre:'权杖',sceptres:'权杖',warcry:'战吼',warcries:'战吼',totem:'图腾',totems:'图腾',
  monster:'怪物',monsters:'怪物',enemy:'敌人',enemies:'敌人',player:'玩家',players:'玩家',ally:'友军',allies:'友军',
  increased:'提高',reduced:'降低',more:'总增',less:'总降',additional:'额外',faster:'加快',slower:'减慢',
  gain:'获得',gains:'获得',gained:'获得',adds:'附加',add:'附加',deal:'造成',deals:'造成',take:'承受',takes:'承受',taken:'承受',
  penetrate:'穿透',penetrates:'穿透',recover:'恢复',recouped:'补偿',leech:'偷取',leeches:'偷取',break:'击破',breaks:'击破',
  per:'每',second:'秒',when:'当',while:'当',recently:'近期',kill:'击败',killed:'击败',use:'使用',used:'使用',using:'使用',
  all:'所有',your:'你的',you:'你',their:'其',this:'该',that:'该',from:'来自',with:'使用',as:'作为',of:'的',to:'至',and:'与',or:'或',
  an:'一个',a:'一个',the:'',for:'',in:'在',on:'时',if:'若',have:'拥有',has:'拥有',are:'',is:'',be:'',by:'由',
  map:'地图',maps:'地图',waystone:'引路石',waystones:'引路石',essence:'精华',essences:'精华',rune:'符文',runes:'符文',
  soul:'灵魂',core:'核心',cores:'核心',socket:'插槽',sockets:'插槽',ritual:'祭祀',omen:'预兆',omens:'预兆',tribute:'贡品',
  delirium:'惊悸迷雾',fog:'迷雾',breach:'裂隙',breaches:'裂隙',expedition:'探险',remnant:'遗物',remnants:'遗物',
  unique:'传奇',rare:'稀有',magic:'魔法',normal:'普通',corrupted:'腐化',desecrated:'亵渎',prefix:'前缀',suffix:'后缀',modifier:'词缀',modifiers:'词缀',
  offering:'奉献',offerings:'奉献',aura:'光环',auras:'光环',meta:'元技能',triggered:'触发的',mark:'印记',marks:'印记',
  grenade:'榴弹',grenades:'榴弹',companion:'伙伴',companions:'伙伴',commandable:'可指挥',invocated:'祈唤',invocation:'祈唤',
  onslaught:'猛攻',incision:'切创',pin:'定身',daze:'迷眩',blind:'致盲',deflect:'偏斜',deflected:'偏斜',parried:'招架',guard:'防护',
  runic:'符文',ward:'护卫',overflow:'溢出',infusion:'灌注',infusions:'灌注',verisium:'维里西姆',kalguuran:'卡尔葛',alloy:'合金',alloys:'合金',flux:'通量',fluxes:'通量',
  augment:'强化物',augments:'强化物',socketbound:'插槽绑定',martial:'武术',command:'指挥',commanding:'指挥',recipe:'配方',recipes:'配方',
  notable:'核心天赋',passive:'天赋',allocate:'配置',allocates:'配置',global:'全局',efficiency:'效率',cost:'消耗',reloaded:'装填',reload:'装填',
  chain:'连锁',fork:'分裂',pierce:'穿透',forking:'分裂',terrain:'地形',low:'低',recently:'近期',fully:'完全',broken:'击破',equipped:'装备的',
  socketed:'已镶嵌',socketable:'插槽强化物',mythical:'神话',meta:'元技能',ancient:'远古',perfect:'完美',extract:'提取',extraction:'提取',
  abysmal:'深渊',abyssal:'深渊',ancient:'远古',preserved:'保存完好的',gnawed:'啃噬的',altered:'异变的',
  collarbone:'锁骨',jawbone:'颚骨',rib:'肋骨',vertebrae:'脊椎骨',skull:'颅骨',bone:'骨材',bones:'骨材',
  adept:'精通',greater:'高阶',perfect:'完美',lesser:'次级',masterwork:'大师工艺',extraction:'提取',
  abrasion:'磨蚀',alacrity:'迅捷',animosity:'敌意',control:'掌控',decay:'腐朽',detonation:'爆破',
  vitality:'活力',sorcery:'巫术',battle:'战斗',blood:'鲜血',mind:'心智',body:'躯体',wealth:'财富',torment:'折磨',
  advanced:'进阶',expert:'专家级',elite:'精英级',grand:'宏伟',great:'巨型',heavy:'沉重',light:'轻型',fine:'精制',
  azure:'蔚蓝',crimson:'绯红',broadhead:'阔头',blazon:'纹章',crest:'冠徽',corroded:'锈蚀',changeling:'变形',
  crude:'粗制',dull:'钝化',glass:'玻璃',golden:'黄金',ashen:'灰烬',chain:'锁链',mail:'甲胄',garment:'长衣',
  dusk:'暮色',gloam:'幽暮',distorted:'扭曲',runeforged:'符文锻造',ancient:'远古'
});

const PHRASES = [
  [/Amanamu/gi,'阿玛纳姆'],[/Kurgal/gi,'库尔加尔'],[/Ulaman/gi,'乌拉曼'],[/Tecrod/gi,'泰克罗德'],[/Kulemak/gi,'库勒马克'],
  [/Faridun/gi,'法里顿'],[/Vaal/gi,'瓦尔'],[/Ezomyte/gi,'艾兹麦'],[/Bramble/gi,'荆棘'],[/Transcended/gi,'超凡'],[/Iron Guards?/gi,'铁卫'],
  [/Temporal Chains/gi,'时空锁链'],[/Elemental Weakness/gi,'元素要害'],[/Enfeeble/gi,'衰弱'],[/Delirium Fog/gi,'惊悸迷雾'],
  [/Energy Shield/gi,'能量护盾'],[/Critical Damage Bonus/gi,'暴击伤害加成'],[/Critical Hit Chance/gi,'暴击率'],[/Attack and Cast Speed/gi,'攻击与施法速度'],
  [/Mana Regeneration Rate/gi,'魔力再生速率'],[/Life Regeneration Rate/gi,'生命再生速率'],[/Cooldown Recovery Rate/gi,'冷却恢复速率'],
  [/Area of Effect/gi,'效果范围'],[/Skill Effect Duration/gi,'技能效果持续时间'],[/Item Rarity/gi,'物品稀有度'],
  [/Power Charges?/gi,'暴击球'],[/Frenzy Charges?/gi,'狂怒球'],[/Endurance Charges?/gi,'耐力球']
];

function cleanupChinese(value) {
  return String(value || '')
    .replace(/\s*([，。；：、（）])\s*/g,'$1')
    .replace(/\s*,\s*/g,'，').replace(/\s*;\s*/g,'；')
    .replace(/\s+/g,' ').replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,'$1').replace(/，+/g,'，').trim();
}


function hasChinese(value) {
  return /[一-鿿]/.test(String(value || ''));
}
function hasPlaceholder(value) {
  return /专有名称|未知主题|未命名/.test(String(value || ''));
}
function fallbackSourceName(original, fallback) {
  const text = cleanupChinese(String(original || '').trim());
  return text || fallback;
}
function safeLocalizedText(localized, original, fallback = '') {
  const text = cleanupChinese(String(localized || '').trim()).replace(/专有名称(?:\s*专有名称)*/g, '').trim();
  if (text && !hasPlaceholder(text) && !/[的之]$/.test(text)) return text;
  return fallbackSourceName(original, fallback);
}

function localizeBaseName(name) {
  const text = String(name || '').trim();
  const exact = BASE_NAMES[text] || Object.entries(BASE_NAMES).find(([key]) => key.toLowerCase() === text.toLowerCase())?.[1];
  if (exact) return exact;
  return cleanupChinese(text
    .replace(/Body Armour/gi,'胸甲').replace(/Helmet/gi,'头盔').replace(/Gloves/gi,'手套').replace(/Boots/gi,'鞋子')
    .replace(/Shield/gi,'盾牌').replace(/Waystone/gi,'引路石').replace(/STR/g,'力量').replace(/DEX/g,'敏捷').replace(/INT/g,'智慧'));
}

function translateTokens(input) {
  let text = String(input || '').trim();
  for (const [pattern,replacement] of PHRASES) text = text.replace(pattern,replacement);
  text = text.replace(/[A-Za-z][A-Za-z'’-]*/g, token => WORDS[token.toLowerCase()] ?? '专有名称');
  return cleanupChinese(text);
}

function translateByPattern(english) {
  const text = String(english || '').trim();
  let m;
  m = text.match(/^\+# to Level of all (.+?) Skills$/i); if (m) return `所有${translateTokens(m[1])}技能等级 +#`;
  m = text.match(/^\+#% to Maximum (.+?) Resistance$/i); if (m) return `${translateTokens(m[1])}抗性上限 +#%`;
  m = text.match(/^\+#% to all Maximum Elemental Resistances$/i); if (m) return '所有元素抗性上限 +#%';
  m = text.match(/^\+#(?:%?) to (.+)$/i); if (m) return `+#${text.includes('#%')?'%':''} ${translateTokens(m[1])}`;
  m = text.match(/^#% increased (.+)$/i); if (m) return `${translateTokens(m[1])}提高 #%`;
  m = text.match(/^#% reduced (.+)$/i); if (m) return `${translateTokens(m[1])}降低 #%`;
  m = text.match(/^#% more (.+)$/i); if (m) return `${translateTokens(m[1])}总增 #%`;
  m = text.match(/^#% less (.+)$/i); if (m) return `${translateTokens(m[1])}总降 #%`;
  m = text.match(/^Adds # to # (.+?)(?: to Attacks)?$/i); if (m) return `攻击附加 # 至 # ${translateTokens(m[1])}`;
  m = text.match(/^Damage Penetrates #% (.+?) Resistance$/i); if (m) return `伤害穿透 #% ${translateTokens(m[1])}抗性`;
  m = text.match(/^Gain #% of Damage as Extra (.+?) Damage$/i); if (m) return `获得等同于伤害 #% 的额外${translateTokens(m[1])}伤害`;
  m = text.match(/^#% chance to (.+)$/i); if (m) return `${translateTokens(m[1])}几率 #%`;
  m = text.match(/^Leech(?:es)? #% of (.+?) as (Life|Mana)$/i); if (m) return `将${translateTokens(m[1])}的 #% 偷取为${translateTokens(m[2])}`;
  m = text.match(/^Gain # (Life|Mana) per enemy killed$/i); if (m) return `每击败一个敌人获得 # ${translateTokens(m[1])}`;
  m = text.match(/^Recover #% of maximum (Life|Mana) on Kill$/i); if (m) return `击败敌人时恢复 #% 最大${translateTokens(m[1])}`;
  m = text.match(/^Area contains # additional packs of (.+)$/i); if (m) return `区域额外包含 # 群${translateTokens(m[1])}`;
  m = text.match(/^Area contains an additional (.+)$/i); if (m) return `区域额外包含 1 个${translateTokens(m[1])}`;
  m = text.match(/^Minions have #% increased (.+)$/i); if (m) return `召唤生物的${translateTokens(m[1])}提高 #%`;
  if (/^#% of Damage is taken from Mana before Life$/i.test(text)) return '承受伤害的 #% 优先从魔力扣除，再扣除生命';
  return null;
}

function localizeModifierName(englishName, id='') {
  const original = String(englishName || '').trim();
  if (!original) return id ? `未命名词缀（数据编号 ${id}）` : '未命名词缀';
  if (hasChinese(original) && !/[A-Za-z]{3,}/.test(original)) return cleanupChinese(original);
  const localized = cleanupChinese(translateByPattern(original) || translateTokens(original));
  return safeLocalizedText(localized, original, id ? `来源词缀（数据编号 ${id}）` : '来源词缀');
}

function localizeConcreteBaseName(englishName, poolName, id='') {
  const source = String(englishName || '').trim();
  if (hasChinese(source) && !/[A-Za-z]{3,}/.test(source)) return cleanupChinese(source);
  let translated = translateTokens(source);
  translated = translated.replace(/专有名称(?:\s*专有名称)*/g,'').trim();
  const poolLabel = localizeBaseName(poolName);
  const genericOnly = !translated || translated.length < 2 || /具体基底$/.test(translated);
  if (genericOnly) return fallbackSourceName(source, `${poolLabel}具体基底`);
  if (!translated.includes(poolLabel) && !/[戒指项链腰带箭袋盾牌爪匕首剑斧锤杖弓枪甲盔手套鞋子魔杖法杖权杖长棍十字弩法器护符珠宝]/.test(translated)) translated = `${translated}·${poolLabel}`;
  return safeLocalizedText(translated, source, `${poolLabel}具体基底`);
}

const ESSENCE_THEMES = Object.freeze({
  Abrasion:'磨蚀',Alacrity:'迅捷',Battle:'战斗',Body:'躯体',Mind:'心智',Sorcery:'巫术',Vitality:'活力',
  Electricity:'电能',Flames:'火焰',Ice:'冰霜',Haste:'急速',Enhancement:'强化',Ruin:'毁灭',Torment:'折磨',
  Greed:'贪婪',Contempt:'轻蔑',Envy:'嫉妒',Fear:'恐惧',Anguish:'苦痛',Horror:'惊骇',Insanity:'疯狂',
  Delirium:'迷雾',Hysteria:'歇斯底里'
});
function localizeEssenceName(name,id='') {
  const text=String(name||'').trim();
  if (hasChinese(text) && !/[A-Za-z]{3,}/.test(text)) return cleanupChinese(text);
  const m=text.match(/^(Lesser|Greater|Perfect|Corrupted)?\s*Essence of (.+)$/i);
  if (!m) return fallbackSourceName(text, '精华');
  const grade={lesser:'次级',greater:'高阶',perfect:'完美',corrupted:'腐化'}[(m[1]||'').toLowerCase()]||'';
  const theme=ESSENCE_THEMES[m[2]]||translateTokens(m[2]).replace(/专有名称/g,'').trim();
  const localized = `${grade}${theme || ''}精华`;
  return safeLocalizedText(localized, text, grade ? `${grade}精华` : '精华');
}

const SOCKETABLE_TYPE_NAMES = Object.freeze({
  rune:'符文', soulcore:'灵魂核心', alloy:'合金', flux:'通量', idol:'神像',
  abyssal_eye:'深渊之眼', augment:'插槽强化物', socketable:'插槽强化物'
});
function localizeSocketableName(name,type='rune',id='') {
  const text=String(name||'').trim();
  const lowerType = String(type||'').toLowerCase();
  const typeName=SOCKETABLE_TYPE_NAMES[lowerType]||'插槽强化物';
  if (hasChinese(text) && !/[A-Za-z]{3,}/.test(text)) return cleanupChinese(text);
  const soulCoreMatch = lowerType === 'soulcore' ? text.match(/^(?:Soul\s+)?Core of (.+)$/i) : null;
  if (soulCoreMatch) {
    const body = translateTokens(soulCoreMatch[1]).replace(/专有名称/g,'').trim();
    return safeLocalizedText(`${body}灵魂核心`, text, typeName);
  }
  const runeMatch = lowerType === 'rune' ? text.match(/^(.+?)\s+Rune$/i) : null;
  if (runeMatch) {
    const body = translateTokens(runeMatch[1]).replace(/专有名称/g,'').trim();
    return safeLocalizedText(`${body}符文`, text, typeName);
  }
  let translated=translateTokens(text).replace(/专有名称(?:\s*专有名称)*/g,'').trim();
  if (/[’']s/.test(text) || /[’']/.test(translated)) return fallbackSourceName(text, typeName);
  if (translated && !translated.includes(typeName) && !/[符文核心合金通量神像之眼强化物]/.test(translated)) translated=`${translated}${typeName}`;
  return safeLocalizedText(translated, text, typeName);
}

function localizeFreeText(value) { return safeLocalizedText(translateTokens(value), value, cleanupChinese(value)); }

module.exports={BASE_NAMES,SOCKETABLE_TYPE_NAMES,localizeBaseName,localizeModifierName,localizeConcreteBaseName,localizeEssenceName,localizeSocketableName,localizeFreeText};
