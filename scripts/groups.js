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
