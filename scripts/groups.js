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

export const GROUPS = [
  { name: '官方博客',      sources: ['OpenAI', 'Google DeepMind'], context: true,  subBySource: true },
  { name: 'Import AI',     sources: ['Import AI'],                 context: true  },
  { name: 'AINews',        sources: ['AINews'],                    context: false, subBySection: true },
  { name: 'The Rundown AI',sources: ['The Rundown AI'],            context: false }
];

// EN 视图不合并官方博客，按来源平铺，但先后次序跟着组走
export const SOURCE_ORDER = GROUPS.flatMap(g => g.sources);

export const groupOf = src =>
  GROUPS.find(g => g.sources.includes(src)) || GROUPS[GROUPS.length - 1];
