// ============================================================================
// 灵感模块的源注册表 —— 唯一真相源
// ============================================================================
// fetch-candidates.js 按它抓，ideas-deepen.js 按 kind 决定怎么深挖，
// build-ideas-viewer.js 按它生成页面上的「信息源」清单。
//
// ── 两条通道，都进评选 ──────────────────────────────────────────────────
//
// **需求侧**（有人明说自己缺什么）和**供给侧**（今天上新了什么）都要收，
// 但它们的筛法不一样，所以走两条通道：
//
//   demand —— 过 screen.js 的需求规则（有没有说出缺口、是不是一个人做得完）
//   supply —— 不过需求规则（新品当然是「自推」），按新鲜度和热度排
//
// v2 的第一版把供给侧整个砍进附录，那是矫枉过正：即时更新的榜单本身有价值，
// 问题从来不是「收了供给侧」，而是**只收了标题**。
// 一条 Product Hunt 叫「Doop」「Monid」「Touchy」，看标题等于没看。
//
// 所以真正的规矩只有一条：**页面上不出现没被读懂的条目。**
// 每条展示出来的东西都必须带一句「这是什么」，说不出来就不展示。
//
// 另一条同样重要的教训是判断依据不能只有标题：
//
//   2026-09-02 实测：r/SomebodyMakeThis 上「截图 30 秒后自动删除」被选为当日第一，
//   而那条帖子的**第一条评论**就是「iOS 本来就有这个功能」，发帖人自己回了
//   「INCREDIBLE! Thank you!」。只读标题和摘要，这种错必然会犯。
//
// 所以真正的硬规则只有一条：**入选的候选必须深挖正文和评论**。
// 评论区是「有没有竞品、需求真不真」的唯一可靠答案 —— 那条 iOS 的教训就写在评论第一行。
// （这条注释以前写的是「点子池只收需求侧」，那是更早一版的规矩，
//  跟上面「两条通道都进评选」互相矛盾，2026-09-04 顺手改掉）
//
// ── 第三条维度：category（页面上的分类，和 side 是两回事）──────────────────
// side 回答的是「抓取/筛选时怎么处理这条」（demand 过需求规则、supply 不过），
// category 回答的是「读者该把它归进哪个抽屉」，按**做没做出来**分两类：
//
//   idea    —— 还没做出来的：抱怨、想法、需求、别人问该怎么办。
//              哪怕是「已经有人深挖过的成品点子」（IdeaBrowser）也算 idea——
//              它讲的仍然是「这件事该怎么做」，不是一个能点开用的东西。
//   product —— 已经做出来的：不管规模大小，只要有一个能点开看/用的东西
//              （Product Hunt 的新品、Show HN 上一个人周末写的小工具）都算。
//
// 2026-09-04 改版之前分的是「用户视角／产品视角」，按**信息来自哪里**分——
// 结果 Show HN（用户在社区里秀自己做的东西）被归进「用户视角」，
// 但页面上它明明是个可以点开用的产品，跟 Reddit 上一句抱怨完全不是一回事。
// 「有没有做出来」比「从哪冒出来的」更贴近一个创业者真正关心的问题：
// 这一类我该不该做，那一类我的对手/参考是谁。所以换成按成熟度分。
//
// Product Hunt 和 IdeaBrowser 是各自类别里编辑/人工筛过的来源，可信度高于
// 自动抓来的原始帖子——但这只影响读者怎么解读这些条目，不该变成机械的
// 排序规则。2026-09-04 第三次改版之前给它们标了 `featured: true`，
// 效果是不管内容本身怎样，这两个来源永远排最前、永远带星标。
// 读者的反馈很直接：「星标应该标在你觉得重要的内容上，不是按渠道标」——
// 一条来自 Product Hunt 的平庸新品和一条来自 Reddit 但被高度验证的抱怨，
// 值不值得注意跟它从哪来的没关系。所以 `featured` 整个删掉：
// 完整库现在按「类别 → 来源」两层分节展示（各来源的条目天然聚在一起，
// 不需要再靠 featured 把某个来源的条目提到别的来源前面），
// 星标改成逐条判断，见 ideas-style.md 里「星标」那一节。
// ============================================================================

// 2026-09-02 逐个 curl 实测：
//   ✅ reddit .rss（列表 / 搜索 / 帖子详情含评论）、hn.algolia.com（搜索 + items）、
//      api.stackexchange.com、api.github.com、trends.vc、yc rfs、producthunt.com/feed
//   ❌ reddit 的 .json 端点 —— 浏览器 UA 一律 403，只能走 .rss
//   ❌ Upwork RSS 403；Peerlist / theresanaiforthat / toolify —— Cloudflare 403
//   ❌ BetaList / Uneed / MicroLaunch / Exploding Topics / Starter Story —— 无公开 RSS
//   ❌ ideabrowser.com/emails/<日期> —— Vercel 机器人验证，所以只能走 Gmail

// 需求短语。Reddit 全站搜索按这些短语捞 —— 比盯着几个「点子许愿池」子版块强得多，
// 因为真正的缺口在各行各业的垂直社区里，是从业者在抱怨自己每天的活儿。
export const DEMAND_PHRASES = [
  'is there an app that',
  'is there a tool that',
  'someone should build',
  'we still use spreadsheets'
];

// **付费短语。** 这一组是 2026-09-03 补的，补的是一个真实的失败：
// 「扫条码查食品召回」那条各方面都像个好点子 —— 需求具体、没人做、一个人做得完 ——
// 但它绝对不值得做，因为**没有任何人在为这件事花钱**。缺口不等于生意。
//
// BigIdeasDB 的做法印证了同一件事：他们分析五千多条 Upwork 付费任务，
// 逻辑是「一个活反复出现在付费岗位里，预算就已经存在了，你不用创造需求，只要接住」。
//
// 所以专门搜「已经在掏钱」的说法。命中这些的条目在 screen.js 里权重最高。
export const PAYING_PHRASES = [
  'we currently pay',
  'we are paying for',
  'quoted us',
  'per seat per month'
];

export const BOARDS = [
  // ── 需求侧：点子池 ──────────────────────────────────────────────────────
  {
    id: 'somebodymakethis', name: 'r/SomebodyMakeThis', kind: 'reddit',
    url: 'https://www.reddit.com/r/SomebodyMakeThis/new/.rss',
    home: 'https://www.reddit.com/r/SomebodyMakeThis/',
    side: 'demand', category: 'idea', pool: true, cap: 25, deepen: 'reddit',
    // 这个版块一天只有三五条，用默认的三天窗口会饿死；它又是最贴合
    // 「有人明说想要什么」的源，值得多给几天。跨期重复由 seen.json 挡。
    windowDays: 8,
    note: '有人直接点名「谁来做个这个」，评论区常常当场指出已有方案'
  },
  {
    id: 'reddit-search', name: 'Reddit 需求短语', kind: 'reddit-search',
    url: 'https://www.reddit.com/search.rss',
    home: 'https://www.reddit.com/',
    side: 'demand', category: 'idea', pool: true, cap: 40, deepen: 'reddit',
    phrases: DEMAND_PHRASES, window: 'week',
    note: '全站搜「有没有一个能……的工具」这类短语，捞的是垂直行业里的真实缺口'
  },
  {
    id: 'softwarerecs', name: 'Software Recommendations', kind: 'stackexchange',
    url: 'https://api.stackexchange.com/2.3/questions',
    home: 'https://softwarerecs.stackexchange.com/',
    side: 'demand', category: 'idea', pool: true, cap: 25, deepen: 'stackexchange',
    site: 'softwarerecs',
    // unanswered 是这个源最值钱的地方：整站就是「我需要一个能做 X 的软件」，
    // 而「没人答得上来」直接等于「没有现成方案」—— 缺口是站方替你标好的。
    modes: ['unanswered', 'recent'],
    note: '整站就是「我需要一个能做 X 的软件」，自带完整背景；无人回答的那些等于现成的缺口'
  },
  {
    id: 'hn-ask', name: 'Ask HN', kind: 'ask-hn',
    url: 'https://hn.algolia.com/api/v1/search_by_date',
    home: 'https://news.ycombinator.com/ask',
    side: 'demand', category: 'idea', pool: true, cap: 25, deepen: 'hn', minPoints: 3,
    // 不做短语搜索：实测按 "is there a tool that" 搜回来的是 2010–2022 年、
    // 1–9 分的老帖，那种缺口十年后多半已经被填上了。
    // 取最近的 Ask HN，是不是需求交给 ideas-screen.js 判断。
    note: '开发者当下在问什么，评论区里往往直接列出现有方案'
  },
  {
    id: 'gh-requests', name: 'GitHub 高赞功能请求', kind: 'github-issues',
    url: 'https://api.github.com/search/issues',
    home: 'https://github.com/',
    side: 'demand', category: 'idea', pool: true, cap: 6, deepen: 'none',
    minReactions: 40, windowDays: 45,
    // 实测这个源大半是「给现成产品提功能」（openai/codex、claude-code 之类），
    // 不是独立机会。留着是因为偶尔能看到「厂商不做、第三方可以做」的缺口，
    // 但门槛要高、配额要小，否则它会灌满深挖名额。
    note: '带数字的工程需求。大多是给现成产品提功能，只有少数是第三方能补的缺口'
  },
  {
    id: 'reddit-paying', name: 'Reddit 付费信号', kind: 'reddit-search',
    url: 'https://www.reddit.com/search.rss',
    home: 'https://www.reddit.com/',
    side: 'demand', category: 'idea', pool: true, cap: 30, deepen: 'reddit',
    phrases: PAYING_PHRASES, window: 'month',
    // 窗口给一个月而不是一周：说出具体价钱的帖子本来就少，一周捞不到几条。
    //
    // 付费短语在消费场景里同样常见，实测捞回来过「全屋软水系统推荐」「去黑山旅游」
    // 「房租怎么谈」，都真的在讨论报价，但都不是软件需求。
    //
    // 第一版写的是「必须出现软件类词」，结果**把最好的一条误杀了** ——
    // 「zoominfo 报价三个销售给了三个数」正文里写的是 seats（复数），
    // 而白名单里是 \bseat\b。要求命中的规则一旦漏词就误杀，
    // 而误杀在这里的代价远高于放过。所以反过来：只排除明确的消费/家庭话题。
    exclude: /\b(rent|mortgage|landlord|apartment|utilit(y|ies)|insurance premium|car (insurance|loan)|watch(es)?|jewel|wedding|restaurant|hotel|flight|vacation|travel|grocer|furniture|mattress|hvac|plumb|water soften\\w*|lawn|salary negotiat|trip to|sightsee|tourist)\b/i,
    note: '搜「我们现在每月付 X 给 Y」这类说法 —— 已经在掏钱的地方，预算是现成的'
  },
  {
    id: 'msp', name: 'r/msp', kind: 'reddit',
    url: 'https://www.reddit.com/r/msp/new/.rss',
    home: 'https://www.reddit.com/r/msp/',
    side: 'demand', category: 'idea', pool: true, cap: 20, deepen: 'reddit', windowDays: 4,
    // 托管服务商：他们靠工具吃饭，每天都在比价、换供应商、抱怨订阅涨价。
    // 这是全站少数「说需求时会顺口报出单价」的人群。
    note: '托管服务商。他们靠工具吃饭，讨论里天天带着单价和供应商名字'
  },
  {
    id: 'sysadmin', name: 'r/sysadmin', kind: 'reddit',
    url: 'https://www.reddit.com/r/sysadmin/top/.rss?t=week',
    home: 'https://www.reddit.com/r/sysadmin/',
    side: 'demand', category: 'idea', pool: true, cap: 15, deepen: 'reddit',
    note: '企业 IT 的一周热帖，手里有采购预算，抱怨的是真实工作流'
  },
  {
    id: 'microsaas', name: 'r/microsaas', kind: 'reddit',
    url: 'https://www.reddit.com/r/microsaas/new/.rss',
    home: 'https://www.reddit.com/r/microsaas/',
    side: 'demand', category: 'idea', pool: true, cap: 20, deepen: 'reddit',
    note: '从业者抱怨自己每天的工具链，尺度接近一个人做得完的东西'
  },

  // ── 参考侧：不进点子池，只提供方向和「今天在发生什么」 ──────────────────
  {
    id: 'ycrfs', name: 'YC Requests for Startups', kind: 'ycrfs',
    url: 'https://www.ycombinator.com/rfs',
    home: 'https://www.ycombinator.com/rfs',
    side: 'trend', category: 'idea', pool: false, cap: 15, deepen: 'none', cadence: 'weekly',
    note: 'YC 公开说想投什么方向。一年才变几次，看方向不看条目'
  },
  {
    id: 'trendsvc', name: 'Trends.vc', kind: 'rss',
    url: 'https://trends.vc/feed/',
    home: 'https://trends.vc/',
    side: 'trend', category: 'idea', pool: false, cap: 6, deepen: 'none',
    note: '每期拆解一个细分赛道'
  },
  {
    id: 'producthunt', name: 'Product Hunt', kind: 'rss',
    url: 'https://www.producthunt.com/feed',
    home: 'https://www.producthunt.com/',
    side: 'supply', category: 'product', pool: true, cap: 20, deepen: 'producthunt', dateless: true,
    // PH 的 content 末尾固定挂着两个链接（Discussion / Link），剥完标签后
    // 它们的文字会黏在摘要屁股上。摘要要的是那句产品描述，尾巴切掉。
    trimTail: /\s*Discussion\s*\|?\s*Link\s*$/i,
    note: '每日新品榜。自带一句话产品描述，是「今天上新了什么」的主力。' +
      '「深挖」只做一件事：访问产品页拿 followersCount（服务端渲染的 JSON 里现成的），' +
      '没有评论区可抓'
  },
  {
    id: 'showhn', name: 'Show HN', kind: 'hn', url:
      'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=60',
    home: 'https://news.ycombinator.com/show',
    // 一个人周末写完发出来的东西，规模小但**是个能点开用的产品**，
    // 归 product 类；side 仍是 supply（抓取/筛选层面不过需求规则，这个没变）
    side: 'supply', category: 'product', pool: true, cap: 20, deepen: 'hn', minPoints: 8,
    // 深挖 Show HN 是有回报的：评论区常常直接说「X 早就在做这个了」，
    // 那既是竞品信息，也是判断这条值不值得关注的依据。
    note: '开发者自己发布的项目，带票数和评论区的真实反馈'
  }
];

// ── Gmail 允许清单 ────────────────────────────────────────────────────────
// **只抓这些发件人**，永远不做「收件箱里所有邮件」这种事。
// 仓库是公开的，允许清单是这套设计里最重要的一道闸。
export const NEWSLETTERS = [
  {
    id: 'ideabrowser', name: 'IdeaBrowser', from: 'notifications@mail.ideabrowser.com',
    home: 'https://www.ideabrowser.com/', parser: 'ideabrowser',
    side: 'demand', category: 'idea', pool: true, cap: 6, deepen: 'none',
    note: '每天一条已经深挖过的点子。公开归档页被机器人验证挡死，只能走邮箱'
  },
  {
    id: 'mobbin', name: 'Mobbin', from: 'newsletter@mobbin.com',
    home: 'https://mobbin.com/', parser: 'generic',
    side: 'trend', category: 'product', pool: false, cap: 6, deepen: 'none',
    note: '每周两封，新收录的产品与交互模式。只作附录'
  }
];

export const ALL_SOURCES = [...BOARDS, ...NEWSLETTERS];
export const sourceById = id => ALL_SOURCES.find(s => s.id === id) || null;
export const POOL_IDS = new Set(ALL_SOURCES.filter(s => s.pool).map(s => s.id));

// side 只服务抓取/筛选层（fetch-candidates.js、screen.js、ideas-archive.js 的排序），
// 页面展示不再用它分组 —— 见下面的 category。
export const SIDE_ORDER = ['demand', 'supply', 'trend'];
export const SIDE_LABEL = { demand: '有人在要', supply: '有人做了', trend: '风往哪吹' };

// 页面上唯一的两个抽屉：点子在前（先看有什么人在喊缺什么），产品在后
// （再看已经有谁在做、做成什么样）。没有第三个类别 —— 风向类的源
// （YC RFS、Trends.vc 折进「点子」，Mobbin 折进「产品」）也要落进这两个之一，
// 不再单独立一栏，那样会显得像是第三种平级类别，其实它们只是补充信号。
export const CATEGORY_ORDER = ['idea', 'product'];
export const CATEGORY_LABEL = { idea: '点子', product: '产品' };
export const CATEGORY_LABEL_EN = { idea: 'Ideas', product: 'Products' };
