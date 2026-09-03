// ============================================================================
// 预筛：从几十条候选里挑出值得深挖的
// ============================================================================
// 这一层**完全确定性**，不用模型。理由有三个：
//   1. 深挖一条要一次带退避的请求，全量深挖会跑成半小时 —— 必须先砍掉九成
//   2. 规则写死在这里，看得见、改得动、能解释「这条为什么没进」
//   3. 便宜。模型的判断力应该花在剩下那二十条的深度理解上，不是筛垃圾
//
// 判断标准来自一句话：
//
//   **一个点子 = 有人在具体场景里遇到具体问题，而且一个人做得出来。**
//
// 所以三组规则：出局（根本不是需求）、加分（是真需求的迹象）、
// 减分（是需求但一个人做不了）。
// ============================================================================

// ── 出局：这些根本不是「有人缺什么」 ────────────────────────────────────
// 每条都标了它想挡住什么，改的时候别删注释 —— 否则半年后没人知道为什么有这条。
export const REJECT = [
  [/\b(hiring|we'?re hiring|who (wants to be hired|is hiring)|seeking work|looking for a (co-?founder|cofounder|developer|designer|partner)|freelanc\w+ (available|for hire))\b/i, '招聘找人'],
  // 「某产品要停服了」是新闻不是需求。它偶尔确实是机会（去做替代品），
  // 但那种机会会以「alternative to X」的形式另外冒出来，那条有加分规则接着。
  [/\b(retirement notice|shutting down|end of life|discontinued|no longer works|has been sunset)\b/i, '停服通知'],
  [/\b(roast my|rate my|feedback on my|check out my|thoughts on my|review my)\b/i, '求反馈'],
  [/\b(i (just )?(built|made|created|launched|shipped|released)|just launched|my (new )?(saas|app|tool|startup)|i'?ve been building)\b/i, '自推'],
  [/\b(survey|questionnaire|fill out|take (the|my) (quiz|poll)|user validation)\b/i, '调查问卷'],
  [/\b(crypto|cryptocurrency|token|airdrop|web3|nft|blockchain|memecoin)\b/i, '加密货币'],
  [/\b(how do you (cope|survive|deal with|stay)|burnout|imposter|motivation|emotional|lonel|mental health)\b/i, '心理求助'],
  [/\b(where do (you|i) (announce|post|share|launch)|does (hn|reddit)|this sub(reddit)?|meta post)\b/i, '元讨论'],
  [/\b(first (paying )?customer|got my first|\d+ users?, ?(now )?what|milestone|revenue update|mrr update)\b/i, '里程碑分享'],
  [/^(what|which) (is|are) (the )?(best|your favou?rite)\b/i, '口味投票'],
  // 个人设备故障求助：「我的 3DS 有坏点怎么办」。它会命中「在找但没找到」
  // 这条加分（"is there a way to fix"），实测混进过候选 —— 但它是一次性的
  // 个人麻烦，不是一群人的需求，做不出产品。
  [/\b(how (do|can) i (fix|repair|get rid of)|any ?(way|idea|one know how) to fix|is (this|it) (normal|fixable)|troubleshoot|warranty|\brma\b)/i, '个人故障求助'],
  [/\bmy (new |old )?(phone|laptop|tablet|monitor|screen|printer|router|3ds|switch|ps5|xbox|tv|car|pc)\b/i, '个人设备问题'],
];

// ── 加分：真需求的迹象 ──────────────────────────────────────────────────
// 权重不是拍脑袋的：越是「明确说出缺口」的说法给得越高，
// 越是「描述现状」的说法给得越低 —— 后者要靠正文才判断得了。
export const SIGNALS = [
  // **有人已经在掏钱** —— 权重最高的一类，2026-09-03 补的。
  // 补的是一个真实的失败：「扫条码查食品召回」需求具体、没人做、一个人做得完，
  // 但没有任何人在为这件事花钱，所以它绝对不值得做。**缺口不等于生意。**
  // 说得出「我们每月付 X 给 Y」的地方，预算是现成的，你只要接住。
  [/\b(we (currently )?pay|we'?re paying|paying \$|costs? us \$|quoted us|per seat|\/seat|per user per month|our (vendor|provider) charges|renewal (quote|price)|budget of \$)/i, 8, '已经在花钱'],
  [/\$\s?\d[\d,]*\s?(\/|per\s)?(mo|month|yr|year|seat|user|k\b)/i, 5, '提到了具体金额'],
  // 直说缺口
  [/\b(someone should (build|make)|somebody should (build|make)|why is there no|why isn'?t there|i wish there was|i wish there were|i'?d pay for)\b/i, 6, '直说缺口'],
  [/\b(is there (an? )?(app|tool|software|service|way)|does anyone know of|looking for (a|an) (tool|app|software)|can'?t find (a|any)\b)/i, 5, '在找但没找到'],
  // 描述凑合方案 —— 这是最硬的信号：有人已经在用笨办法解决了，说明痛是真的
  [/\b(we still use|we currently use|spreadsheet|excel|google sheets?|manually|by hand|copy.?pasting?|copy and paste)\b/i, 4, '在用笨办法凑合'],
  [/\b(takes? (me|us) (\d+|several|a few) (hours?|minutes?|days?)|spend (hours|days)|every (week|day|month) i)\b/i, 4, '有时间成本'],
  // 有具体场景和人
  [/\b(our (team|clients?|customers?|students?|patients?)|my (clients?|customers?|students?|patients?)|at work|small business|freelancers?|agenc(y|ies))\b/i, 3, '有具体人群'],
  // 在找替代品 = 现有方案不够好，且这人已经在付钱
  [/\b(alternative to|migrat\w+ (from|away)|switch(ing)? (from|away)|replace \w+ with|fed up with|sick of)\b/i, 3, '在换掉现有方案'],
];

// ── 减分：是需求，但一个人做不出来 ──────────────────────────────────────
// 这些不是「坏点子」，只是不适合你 —— 目标明确写着「一个人能做完」。
export const PENALTY = [
  [/\b(hardware|device|sensor|wearable|3d.?print|manufactur|physical product|injection mold)\b/i, -8, '要做硬件'],
  [/\b(marketplace|two.?sided|connect (buyers|sellers|drivers|volunteers|tutors)|matching platform|gig (economy|workers))\b/i, -7, '双边市场冷启动'],
  [/\b(hipaa|gdpr compliance|licens(ed|ing|e required)|regulat|fda|medical device|banking licen|kyc)\b/i, -6, '要牌照或合规'],
  [/\b(social network|community platform|forum for|user.?generated|creator economy)\b/i, -5, '要先有人气'],
  [/\b(train (a|our own) (model|llm)|foundation model|from scratch|distributed system at scale)\b/i, -4, '工程量过大'],
  // 「要一个库」不是「要一个产品」。SoftwareRecs 上这类请求很多
  //（"C++ library for probability distributions"、"Parser for MIB files in Java"），
  // 它们是真需求，但受众是几十个开发者，撑不起一个人做的产品。
  [/\b(library|libraries|sdk|npm (package|module)|maven|nuget|pip package|header.?only|bindings? for)\b/i, -5, '要的是库不是产品'],
];

// 互动量：不同源的量纲差得远，各自折算成一个 0–8 的分
function engagementScore(it) {
  const g = it.signal || {};
  if (g.thumbsUp != null) return Math.min(8, Math.round(g.thumbsUp / 8));        // GitHub 点赞
  if (g.views != null) {
    // Stack Exchange：浏览量比分数有意义得多（这类问题很少有人投票）。
    // 但老问题的浏览量会一直累积，不封顶的话所有条目都会顶到满分、
    // 分数就失去了区分度 —— 所以浏览量那部分单独封在 4 分。
    // unanswered 额外加 3：没人答得上来，本身就是「没有现成方案」的证据。
    return Math.min(4, Math.round((g.views || 0) / 300)) + (g.unanswered ? 3 : 0);
  }
  if (g.points != null) return Math.min(8, Math.round((g.points + (g.comments || 0)) / 6));
  // Reddit 的 RSS 不给分数（要到深挖阶段才拿得到），给个中性基础分。
  // 早先给 1 分，结果 Stack Exchange 靠浏览量稳拿 7 分，Reddit 被系统性挤出名额 ——
  // 而 r/SomebodyMakeThis 恰恰是最贴合「有人明说想要什么」的源。
  // 缺数据不该等于低分，该等于「按文本判断」。
  return 3;
}

// 正文长度：肯这么写的人是真在描述一个问题；一句话标题党没什么可判断的
function depthScore(text) {
  const n = String(text || '').length;
  if (n >= 600) return 4;
  if (n >= 300) return 3;
  if (n >= 120) return 1;
  return -2;
}

// 源可以声明一条 exclude：命中就整条不要。
// 规则写在注册表里而不是这里，因为它描述的是那个源的性质，不是通用判断。
// 用「排除」而不是「要求命中」是有教训的：要求命中的白名单一旦漏词就误杀，
// 而误杀一条好需求的代价远高于放过一条噪声。
import { sourceById } from '../idea-sources.js';

export function screen(it) {
  const bad = sourceById(it.sourceId)?.exclude;
  if (bad && bad.test(`${it.title || ''}\n${it.summary || ''}`)) {
    return { keep: false, score: 0, reason: '消费/家庭话题，不是软件需求', hits: [] };
  }

  // 供给侧走另一条路：新品当然是「自推」，拿需求规则去筛它等于全部毙掉。
  // 它要回答的问题也不一样 —— 不是「有人缺什么」，而是「今天上新了什么，
  // 值不值得你看一眼」。所以只按热度和有没有描述排，不做需求判定。
  if (it.side === 'supply') {
    const g = it.signal || {};
    const heat = g.points != null ? Math.min(8, Math.round((g.points + (g.comments || 0)) / 8)) : 3;
    // 没有描述的新品在页面上没法解释，直接不要 —— 「Doop」这种标题看了等于没看
    const described = (it.summary || '').length >= 25;
    return {
      keep: described,
      score: described ? heat + 4 : 0,
      hits: ['上新'],
      detail: { signal: 0, engagement: heat, depth: described ? 4 : -99 },
      reason: described ? null : '只有名字没有描述，无法解释'
    };
  }

  const hay = `${it.title || ''}\n${it.summary || ''}`;

  for (const [re, why] of REJECT) {
    if (re.test(hay)) return { keep: false, score: 0, reason: why, hits: [] };
  }

  const hits = [];
  let score = 0;
  for (const [re, w, label] of SIGNALS) if (re.test(hay)) { score += w; hits.push(label); }
  for (const [re, w, label] of PENALTY) if (re.test(hay)) { score += w; hits.push(label); }

  const eng = engagementScore(it);
  const depth = depthScore(it.summary);
  score += eng + depth;

  return {
    keep: true,
    score,
    hits,
    detail: { signal: score - eng - depth, engagement: eng, depth },
    reason: null
  };
}

// 给一批候选打分并排序。
export function rank(items) {
  return items
    .map(it => ({ it, s: screen(it) }))
    .sort((a, b) => b.s.score - a.s.score);
}

// 选出要深挖的那一批。
//
// 单源配额是必需的：SoftwareRecs 一天能出 25 条、r/SomebodyMakeThis 只有 5 条，
// 纯按分数取前 N 会让一个源吃掉大半个名额，而它恰恰是最长尾最技术向的那个。
// 分数的作用是「同源之内排序」，跨源之间要靠配额保住多样性。
export function pickForDeepen(items, { top = 20, perSource = 4, minScore = 6, caps = {} } = {}) {
  const ranked = rank(items).filter(x => x.s.keep && x.s.score >= minScore);
  const used = new Map();
  const chosen = [];
  for (const x of ranked) {
    const n = used.get(x.it.sourceId) || 0;
    // caps 允许单个源再收紧（Ask HN 大半是闲聊，GitHub 大半是给现成产品提功能）
    if (n >= (caps[x.it.sourceId] ?? perSource)) continue;
    used.set(x.it.sourceId, n + 1);
    chosen.push(x);
    if (chosen.length >= top) break;
  }
  return { chosen, ranked };
}
