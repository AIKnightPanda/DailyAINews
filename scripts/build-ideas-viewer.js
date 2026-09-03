#!/usr/bin/env node

// ============================================================================
// 生成灵感页 docs/ideas.html
// ============================================================================
// 和 build-viewer.js 是姊妹脚本，**共用 viewer/template.html** ——
// 样式仍然只有一个真相源，改模板两个页面一起变。差异全部由注入的 site
// 字段描述（报头文案、没有 EN 视图、指回简报页的互跳链接）。
//
// 和简报页的两点不同：
//   - 没有 EN 原文视图。灵感条目本来就是标题 + 一小段，没有「全文」这一层，
//     再做一个 EN 视图只会是同一批英文标题再列一遍。
//   - 「信息源」面板读 scripts/idea-sources.js，和实际抓取用的是同一份注册表。
//
// 用法: node scripts/build-ideas-viewer.js
// ============================================================================

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BOARDS, NEWSLETTERS } from './idea-sources.js';
import { renderRunnerUps, restRows, renderFailures, textOf, resolvePicks, stripPicks, KIND } from './lib/ideas-render.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDEAS_DIR = join(ROOT, 'ideas');
const RAW_DIR = join(IDEAS_DIR, 'raw');
const TEMPLATE = join(ROOT, 'viewer', 'template.html');
const DOCS_DIR = join(ROOT, 'docs');
const EN_DIR = join(DOCS_DIR, 'ideas-source');   // EN 正文按期单独存，点开才加载

const DATA_SLOT = /\/\*__DIGEST_DATA__\*\/[\s\S]*?\/\*__END__\*\//;
const HEAD_END = '<!--__HEAD_END__-->';

const readOptional = p => {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); }
  catch { return null; }   // 坏了当缺失处理，不让页面出不来
};

// 扁平 YAML frontmatter，只支持 `key: value` —— 不引第三方解析器
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    let value = raw;
    if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
    else if (raw !== '' && !Number.isNaN(Number(raw))) value = Number(raw);
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

async function collectIssues() {
  if (!existsSync(IDEAS_DIR)) return [];
  const files = (await readdir(IDEAS_DIR))
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort().reverse();          // 最新一期在前

  const issues = [];
  for (const file of files) {
    const { meta, body } = parseFrontmatter(await readFile(join(IDEAS_DIR, file), 'utf-8'));
    const issue = meta.issue || file.replace(/\.md$/, '');

    // 条目数照原始档念，不照 frontmatter 念 —— frontmatter 是模型写的，
    // 原始档是脚本写的。两者不一致时以脚本那份为准。
    const rawPath = join(RAW_DIR, `${issue}.json`);
    let counts = { total: 0, pool: 0, screened: 0, candidates: 0 };
    let rawBytes = 0;
    let raw = null;
    if (existsSync(rawPath)) {
      rawBytes = (await stat(rawPath)).size;
      raw = readOptional(rawPath);
      if (raw) {
        const pool = raw.items.filter(x => x.pool);
        counts = {
          total: raw.items.length,
          pool: pool.length,
          screened: pool.filter(x => x.screen?.keep).length,
          candidates: raw.items.filter(x => x.candidate).length
        };
      }
    }

    // 精选卡片的数据：中文解读来自 picks，英文那半边直接取原文 ——
    // 解读是模型替你做的判断，本来就没有「原文」可对照，
    // 切到 EN 是为了核对原始信息，所以给英文原标题和原文摘要。
    const zh = readOptional(join(IDEAS_DIR, 'zh', `${issue}.json`));
    const picks = readOptional(join(IDEAS_DIR, 'picks', `${issue}.json`));
    let cards = [];
    if (raw && picks) {
      cards = resolvePicks(raw, picks).list.map(({ p, it }) => ({
        ref: it.ref, source: it.source, url: it.url,
        titleEn: it.title,
        rawEn: (it.deep && it.deep.body) || it.summary || '',
        title: p.title || textOf(it, zh, 'zh').title,
        kind: KIND[p.kind] || '',
        score: p.score ?? null,
        how: p.how || '',
        // 六栏，顺序有讲究：「钱在哪里」紧跟在「谁在要」后面 ——
        // 判断一条需求先找钱，找不到钱就不该出现在这一节里。
        fields: [
          ['是什么', p.what], ['谁在要', p.who], ['钱在哪里', p.paying],
          ['已有方案', p.state], ['怎么找到人', p.reach], ['判断', p.verdict]
        ].filter(([, v]) => v)
      }));
    }
    const cardsCount = cards.length;

    issues.push({
      issue,
      headline: meta.headline || '',
      // 复用简报页那套统计条的字段名，模板不必为灵感页改结构
      // 复用简报页那套统计条的字段名，模板不必为灵感页改结构：
      // builders→提炼条数（元信息条用）、tweets/blogs/podcasts→池/读过/提炼（索引卡片用）
      stats: {
        builders: cardsCount, tweets: counts.pool,
        blogs: counts.candidates, podcasts: cardsCount
      },
      rawBytes,
      rawMissing: rawBytes === 0,
      picks: cards,
      // 其余候选走结构化数据，不走 markdown —— 标题、说明、来源、信号
      // 四样东西塞进一个列表项里怎么排都别扭，交给 CSS 才排得开
      rest: raw ? restRows(raw, zh, picks, 'zh') : [],
      restEn: raw ? restRows(raw, zh, picks, 'en') : [],
      hidden: raw ? raw.items.filter(x => x.pool && !x.candidate).length : 0,
      body: '',
      _raw: raw, _zh: zh, _picks: picks     // 只在本进程里用来拼 EN 正文，不进页面
    });
  }
  return issues;
}

// 「信息源」面板：照注册表念，不做统计。
// 抓取和面板读同一份 idea-sources.js —— 面板上写着什么，抓的就是什么。
function sourceManifest() {
  const line = s => ({ name: s.name, url: s.home || null, home: s.home || null, note: s.note || '' });
  return {
    builders: [],
    blogs: BOARDS.filter(s => s.side === 'demand').map(line),
    podcasts: BOARDS.filter(s => s.side !== 'demand').map(line),
    extra: NEWSLETTERS.map(s => ({ name: s.name, home: s.home, note: s.note || '' }))
  };
}

async function main() {
  if (!existsSync(TEMPLATE)) {
    console.error(`找不到模板: ${TEMPLATE}`);
    process.exit(1);
  }

  const issues = await collectIssues();
  const template = await readFile(TEMPLATE, 'utf-8');

  const site = {
    title: '灵感档案',
    // 两条通道分开报数：把上新算进「需求源」会让人以为值得做的是从新品里挑的
    tagline: (() => {
      const all = [...BOARDS, ...NEWSLETTERS].filter(s => s.pool);
      const d = all.filter(s => s.side === 'demand').length;
      const u = all.length - d;
      return `每天从 ${d} 个需求源和 ${u} 个上新榜里找值得做的`;
    })(),
    hasEn: true,                                    // 英文原文视图：同结构、换语言
    sibling: { href: 'index.html', label: '简报' },
    // 版式和简报页完全一样，只有这些字串不同
    text: {
      kicker: '灵感',
      tally: ['池', '读过', '值得做'],
      countWord: '值得做 <b>{n}</b> 条',
      rawPath: 'ideas/raw/',
      sourceDir: 'ideas-source/',
      enIsMarkdown: true,         // EN 和中文是同一套结构，复用 markdown 渲染器
      showFeedAt: false,          // 没有上游 feed，不写「feed 生成于 未知」
      panel: {
        note: '这是配置里的完整清单，不是当期出现过的统计。每天由 GitHub Actions 预抓，Routine 汇总。',
        tier1: '榜单源', tier1sub: '公开接口，每天抓一次',
        g1: '', g2: '需求侧 · 有人明说想要什么', g3: '供给与趋势 · 别人做了什么、风往哪吹',
        tier2: '订阅源 · 邮箱', tier2sub: '只读允许清单内的发件人',
        g4: 'Newsletter'
      }
    }
  };

  // 转义 < 防止正文里的 </script> 提前闭合标签
  // _raw / _zh / _picks 只是本进程拼 EN 正文用的中转，不进页面
  const slim = issues.map(({ _raw, _zh, _picks, ...rest }) => rest);
  const payload = JSON.stringify({
    builtAt: new Date().toISOString(),
    site,
    sourceOrder: [...BOARDS, ...NEWSLETTERS].map(s => s.name),
    sourceManifest: sourceManifest(),
    issues: slim
  }).replace(/</g, '\\u003c');

  if (!DATA_SLOT.test(template)) {
    console.error('模板里找不到数据占位符 /*__DIGEST_DATA__*/…/*__END__*/');
    process.exit(1);
  }
  const filled = template.replace(DATA_SLOT, () => payload);

  const idx = filled.indexOf(HEAD_END);
  if (idx === -1) {
    console.error(`模板里找不到分隔标记 ${HEAD_END}`);
    process.exit(1);
  }
  const html = '<!doctype html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    filled.slice(0, idx) + '</head>\n<body>' + filled.slice(idx + HEAD_END.length) + '\n</body>\n</html>\n';

  await mkdir(DOCS_DIR, { recursive: true });
  await writeFile(join(DOCS_DIR, 'ideas.html'), html);

  // EN 正文：和中文版调同一组排版函数，只是 lang 不同 —— 版式不会漂移。
  // 按期单独一个文件，点「EN」才去取，页面体积不随期数增长。
  await mkdir(EN_DIR, { recursive: true });
  let enCount = 0;
  for (const it of issues) {
    if (!it._raw) continue;
    // EN 正文同样不带精选那一节 —— 卡片在两个视图里都会渲染
    await writeFile(join(EN_DIR, `${it.issue}.json`), JSON.stringify({
      issue: it.issue,
      bodyEn: renderFailures(it._raw).join('\n')
    }));
    enCount++;
  }

  const kb = n => `${Math.round(n / 1024)}KB`;
  console.log(`已生成 docs/ideas.html (${kb(html.length)})：${issues.length} 期，EN 正文 ${enCount} 期`);
  for (const it of issues) {
    console.log(`  ${it.issue}  值得做 ${String(it.stats.builders).padStart(2)} 条` +
      `（池 ${it.stats.tweets} → 读过 ${it.stats.blogs}）` +
      `\t${it.headline || '（本期没有达标的）'}`);
  }
}

main().catch(err => {
  console.error(`[build-ideas-viewer] ${err?.message || err}`);
  process.exit(1);
});
