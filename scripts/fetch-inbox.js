#!/usr/bin/env node

// ============================================================================
// 从 Gmail 抓允许清单内的订阅邮件
// ============================================================================
// 为什么非要走邮箱：IdeaBrowser 每天那封是全清单里质量最高的点子源，
// 而它的公开归档页（ideabrowser.com/emails/<日期>）挂着 Vercel 机器人验证，
// 抓下来只有一页 JS。邮件是唯一的入口。
//
// 三条硬规则：
//
// 1. **只读 NEWSLETTERS 里列出的发件人。** 查询语句由允许清单拼出来，
//    清单之外的邮件连列都不会列到 —— 仓库是公开的，这是最重要的一道闸。
// 2. **只申请 gmail.readonly。** 这个脚本没有能力改动或删除任何邮件。
// 3. **落盘前剥掉个人痕迹。** 退订链接里嵌着 contactId/audienceId 这类
//    per-subscriber token（实测 IdeaBrowser 的退订链接就是一个 JWT），
//    直接提交到公开仓库等于把它送出去。sanitize() 负责清掉。
//
// 凭证走环境变量，脚本本身不含任何密钥：
//   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
// 怎么拿见 scripts/gmail-auth.js 和 ideas/README.md。
//
// 用法: node scripts/fetch-inbox.js [--until=YYYY-MM-DD] [--days=N]
// 输出: JSON 到 stdout（缺凭证时输出带 error 的合法结构，不抛异常）
// ============================================================================

import { NEWSLETTERS } from './idea-sources.js';
import { clip, normalizeUrl, hash10 } from './lib/feedkit.js';
import { pathToFileURL } from 'url';

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';

const DAYS = Number(arg('days')) || 2;
const ANCHOR = arg('until') ? new Date(arg('until') + 'T23:59:59Z') : new Date();
const ymd = d => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SUMMARY_MAX = 700;   // 邮件正文比 RSS 摘要值钱，给得比榜单条目宽

// ── 凭证 ──────────────────────────────────────────────────────────────────

async function accessToken() {
  const { GMAIL_CLIENT_ID: id, GMAIL_CLIENT_SECRET: secret, GMAIL_REFRESH_TOKEN: refresh } = process.env;
  const missing = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`缺少环境变量 ${missing.join('、')}，见 ideas/README.md`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token'
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant 基本只有两个原因：token 被撤销，或 OAuth 应用还在「测试」
    // 状态（Google 会在 7 天后作废测试应用签发的 refresh token）。
    // 把这句写出来，省得下次对着 400 猜。
    const extra = json.error === 'invalid_grant'
      ? '（refresh token 已失效：可能被撤销，或 OAuth 应用还停在「测试」状态——测试态签发的 token 7 天后作废，把应用发布为「正式」即可）'
      : '';
    throw new Error(`换取 access token 失败 HTTP ${res.status} ${json.error || ''}${extra}`);
  }
  return json.access_token;
}

const api = async (token, path) => {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail API HTTP ${res.status} ${path.split('?')[0]}`);
  return res.json();
};

// ── 正文提取与清洗 ────────────────────────────────────────────────────────

const b64 = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');

// MIME 是棵树，text/plain 可能藏在 multipart/alternative 里的任意深度
function plainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64(payload.body.data);
  for (const p of payload.parts || []) {
    const t = plainText(p);
    if (t) return t;
  }
  return '';
}

// 页脚从这些句子开始，往后全是推广和退订，一律丢掉
const FOOTER = /^(you'?re receiving this|unsubscribe|manage preferences|read online|update your preferences|사|©|\s*—\s*$)/i;
// 带个人 token 的链接，一条都不能留
const SECRET_LINK = /(unsubscribe|preferences|notifications|\/account\/|token=|[?&]e=|list-manage)/i;

export function sanitize(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (const line of lines) {
    if (FOOTER.test(line.trim())) break;
    out.push(line);
  }
  return out.join('\n')
    // 剩下的链接里凡是带订阅者标识的整条抹掉，普通链接保留
    .replace(/https?:\/\/\S+/g, u => (SECRET_LINK.test(u) ? '' : u))
    // 收件人邮箱不该出现在公开仓库里
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[邮箱]')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const firstLink = t => {
  const m = /https?:\/\/\S+/.exec(t || '');
  return m && !SECRET_LINK.test(m[0]) ? m[0].replace(/[).,]+$/, '') : null;
};

// ── 各家的版式 ────────────────────────────────────────────────────────────

// IdeaBrowser 每封的骨架是固定的：
//   开场（一段现成的点子）→ IDEA OF THE DAY → TREND OF THE DAY → THAT'S A WRAP
// 前三块是内容，最后一块整段丢掉。三块各成一条，用锚点区分 URL。
export function parseIdeaBrowser(msg, s, body) {
  const cut = body.split(/^\s*THAT'?S A WRAP\s*$/im)[0];
  const marks = [...cut.matchAll(/^\s*(IDEA OF THE DAY|TREND OF THE DAY)\s*$/gim)];
  const day = msg.date.slice(0, 10);
  const home = `https://www.ideabrowser.com/emails/${day}`;

  const blocks = [];
  const opening = cut.slice(0, marks[0]?.index ?? cut.length).trim();
  if (opening.length > 80) blocks.push({ anchor: 'opening', title: msg.subject, text: opening });

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i][0].length;
    const text = cut.slice(start, marks[i + 1]?.index ?? cut.length).trim();
    if (!text) continue;
    // 版块标记的下一行就是这条的标题
    const [head, ...rest] = text.split('\n');
    blocks.push({
      anchor: marks[i][1].toLowerCase().startsWith('idea') ? 'idea' : 'trend',
      title: head.trim(),
      text: rest.join('\n').trim() || head.trim()
    });
  }

  return blocks.map(b => ({
    sourceId: s.id, source: s.name, sourceHome: s.home, side: s.side,
    title: b.title,
    url: `${home}#${b.anchor}`,
    summary: clip(b.text, SUMMARY_MAX),
    publishedAt: msg.date,
    // 开场那段是编辑随手写的，深度不如 IDEA OF THE DAY 那节 —— 标出来，
    // 让写简报的模型知道该优先讲哪条
    depth: b.anchor === 'idea' ? 'deep' : 'brief'
  }));
}

// 没有已知版式的订阅：整封当一条，标题用主题行
function parseGeneric(msg, s, body) {
  return [{
    sourceId: s.id, source: s.name, sourceHome: s.home, side: s.side,
    title: msg.subject,
    url: firstLink(body) || `${s.home}#${msg.date.slice(0, 10)}`,
    summary: clip(body, SUMMARY_MAX),
    publishedAt: msg.date,
    depth: 'brief'
  }];
}

const PARSERS = { ideabrowser: parseIdeaBrowser, generic: parseGeneric };

// ── 自检 ──────────────────────────────────────────────────────────────────
// `node scripts/fetch-inbox.js --selftest`
// sanitize() 是「不把订阅者凭证推进公开仓库」的第一道闸（工作流里的 grep 是第二道）。
// 它没有测试的话，一次看似无害的正则微调就能悄悄把闸打开，而且要等到泄漏之后才发现。
// 样本取自 2026-09-01 那封 IdeaBrowser 的真实页脚结构（token 已替换成假值）。
function selftest() {
  const sample = [
    'Good morning.',
    'IDEA OF THE DAY',
    'Help freelancers get recommended by AI',
    'Run the playbook at https://www.example.com/playbook for solo workers.',
    "THAT'S A WRAP",
    '',
    '—',
    "You're receiving this email because you subscribed to Ideabrowser's Idea of the Day.",
    'Read online: https://www.ideabrowser.com/emails/2026-09-01?utm_source=iotd',
    'Manage preferences: https://www.ideabrowser.com/account/notifications?utm_source=iotd',
    'Unsubscribe: https://unsubscribe.resend.com/?token=eyJhbGciOiJIUzI1NiJ9.FAKEPAYLOAD.FAKESIG',
    'Contact: someone@example.com'
  ].join('\n');

  const out = sanitize(sample);
  const banned = ['unsubscribe', 'resend.com', 'FAKEPAYLOAD', 'token=', '@example.com',
    'account/notifications', 'receiving this email'];
  const kept = ['IDEA OF THE DAY', 'Help freelancers', 'example.com/playbook'];

  let bad = 0;
  for (const b of banned) {
    const leaked = out.toLowerCase().includes(b.toLowerCase());
    if (leaked) bad++;
    console.log(`  ${leaked ? '❌ 残留' : '✅ 已清除'}  ${b}`);
  }
  for (const k of kept) {
    const gone = !out.includes(k);
    if (gone) bad++;
    console.log(`  ${gone ? '❌ 被误删' : '✅ 保留'}  ${k}`);
  }
  // 正文里的正常链接要留住 —— 清洗过头会把点子本身的出处一起洗掉
  console.log(bad ? `\n${bad} 项不通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--selftest')) selftest();

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const token = await accessToken();
  const after = new Date(ANCHOR.getTime() - DAYS * 864e5);
  const before = new Date(ANCHOR.getTime() + 864e5);

  const report = [];
  let items = [];

  for (const s of NEWSLETTERS) {
    try {
      // 查询语句由允许清单拼出来，一个发件人一次查询 —— 比 OR 到一起更好排错
      const q = `from:${s.from} after:${ymd(after)} before:${ymd(before)}`;
      const list = await api(token, `/messages?maxResults=10&q=${encodeURIComponent(q)}`);
      const ids = (list.messages || []).map(m => m.id);

      let got = [];
      for (const id of ids) {
        const msg = await api(token, `/messages/${id}?format=full`);
        const head = n => (msg.payload?.headers || []).find(h => h.name.toLowerCase() === n)?.value || '';
        const meta = {
          subject: head('subject').trim(),
          date: new Date(Number(msg.internalDate)).toISOString()
        };
        const body = sanitize(plainText(msg.payload));
        if (!body) continue;
        got = got.concat((PARSERS[s.parser] || parseGeneric)(meta, s, body));
      }

      got = got
        .filter(x => x.title && x.summary)
        .map(x => {
          const norm = normalizeUrl(x.url);
          return { id: hash10(norm), normUrl: norm, ...x };
        })
        .slice(0, s.cap || 6);

      items = items.concat(got);
      report.push({ id: s.id, name: s.name, status: 'ok', mails: ids.length, items: got.length });
    } catch (err) {
      report.push({ id: s.id, name: s.name, status: 'error', error: String(err?.message || err) });
    }
  }

  console.log(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    windowDays: DAYS,
    windowUntil: ANCHOR.toISOString(),
    sources: report,
    items
  }, null, 2));
}

// 被 import 时不执行 main()，好让解析器能单独测试
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(err => {
  // 没配凭证是常态（本地跑、第一次跑），不该让整条管线炸掉：
  // 输出合法结构 + error，ideas-archive.js 会照常带着榜单条目往下走。
  console.log(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    error: String(err?.message || err),
    sources: [],
    items: []
  }, null, 2));
});
