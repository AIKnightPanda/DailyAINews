// ============================================================================
// 补充源的分组与顺序 —— 唯一真相源
// ============================================================================
// 中文版由 link-digest.js 在构建时排版，EN 视图由 template.html 在浏览器里排版，
// 两个渲染器读同一份定义：link-digest.js 直接 import，
// build-viewer.js 把 SOURCE_ORDER 注入页面数据，前端照着排。
//
// 之前这份顺序在两处各写了一遍，结果漂移成「中文 AINews 在前、EN Rundown 在前」。
// 要改分组或顺序，只改这个文件。
// ============================================================================

// 一个来源就是一组，不再把 OpenAI / DeepMind 合并成「官方博客」——
// 拢共两三条，多一层分类只是多一层缩进，平铺读起来更快，也和 EN 版天然一致。
export const GROUPS = [
  { name: 'OpenAI',         sources: ['OpenAI'],          context: true  },
  { name: 'Google DeepMind',sources: ['Google DeepMind'], context: true  },
  { name: 'Import AI',      sources: ['Import AI'],       context: true  },
  { name: 'The Rundown AI', sources: ['The Rundown AI'],  context: false },
  { name: 'AINews',         sources: ['AINews'],          context: false, subBySection: true }
];

export const SOURCE_ORDER = GROUPS.flatMap(g => g.sources);

export const groupOf = src =>
  GROUPS.find(g => g.sources.includes(src)) || GROUPS[GROUPS.length - 1];

// 补充源的抓取参数与展示信息。fetch-extra.js 按它抓，build-viewer.js 按它
// 生成页面上的「信息源」清单 —— 同一份定义，不会出现清单和实际抓的对不上。
export const SOURCES = [
  // AINews 自己就是日报，一个窗口里可能套进好几期。只取期号当天那一期，
  // 否则「看当期汇总」指向哪一期就说不清了。
  { id: 'ainews',   name: 'AINews',         kind: 'ainews',  url: 'https://news.smol.ai/rss.xml',
    home: 'https://news.smol.ai/', latestOnly: true,
    note: 'smol.ai 的每日聚合，把 X、Reddit、Discord 的讨论汇成一期' },
  { id: 'importai', name: 'Import AI',      kind: 'article', url: 'https://jack-clark.net/feed/',
    home: 'https://jack-clark.net/',
    note: 'Anthropic 联合创始人 Jack Clark 的周刊，取他用「Read more:」标出的一手来源' },
  { id: 'openai',   name: 'OpenAI',         kind: 'simple',  url: 'https://openai.com/news/rss.xml',
    home: 'https://openai.com/news/', enrich: true, note: '官方博客 RSS' },
  { id: 'deepmind', name: 'Google DeepMind',kind: 'simple',  url: 'https://deepmind.google/blog/rss.xml',
    home: 'https://deepmind.google/blog/', enrich: true, note: '官方博客 RSS' },
  { id: 'rundown',  name: 'The Rundown AI', kind: 'simple',  url: 'https://www.therundown.ai/feed',
    home: 'https://www.therundown.ai/', note: '每日 AI 快讯，只取标题和链接' }
];
