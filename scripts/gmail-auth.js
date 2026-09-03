#!/usr/bin/env node

// ============================================================================
// 一次性：换取 Gmail 的 refresh token
// ============================================================================
// 只需要跑一次，跑完把打印出来的 refresh token 自己填进 GitHub Secrets。
// 脚本不保存任何东西，也不含任何密钥 —— client id / secret 从命令行读，
// refresh token 打印到终端由你自己复制。
//
// 用法:
//   node scripts/gmail-auth.js <client_id> <client_secret>
//
// 前置步骤见 ideas/README.md 的「配 Gmail」一节。
//
// 申请的权限只有 gmail.readonly：**只读，不能改、不能删、不能发信。**
// ============================================================================

import { createServer } from 'http';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('用法: node scripts/gmail-auth.js <client_id> <client_secret>');
  console.error('两个参数从 Google Cloud Console 的「OAuth 客户端 ID」页面复制。');
  process.exit(1);
}

const PORT = 8899;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  // offline + consent 缺一不可：只有这样 Google 才会签发 refresh token。
  // 少了 prompt=consent，第二次授权同一个账号时它只给 access token，
  // 你会拿到一个没有 refresh_token 的响应然后一头雾水。
  access_type: 'offline',
  prompt: 'consent'
}).toString();

console.log('\n在浏览器里打开这个地址完成授权：\n');
console.log(authUrl);
console.log(`\n授权后会跳回 ${REDIRECT}，本脚本在这儿等着。\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err || !code) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
       .end(`授权失败：${err || '没拿到 code'}`);
    console.error(`\n授权失败：${err || '没拿到 code'}`);
    server.close();
    process.exit(1);
  }

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECT, grant_type: 'authorization_code'
      })
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) {
      throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
       .end('<h2>拿到了，回终端看。</h2><p>这个页面可以关掉。</p>');

    console.log('\n================ 复制下面这一行 ================\n');
    console.log(j.refresh_token);
    console.log('\n===============================================\n');
    console.log('填到仓库的 Settings → Secrets and variables → Actions：');
    console.log('  GMAIL_CLIENT_ID       = 你刚才传进来的 client id');
    console.log('  GMAIL_CLIENT_SECRET   = 你刚才传进来的 client secret');
    console.log('  GMAIL_REFRESH_TOKEN   = 上面这一行');
    console.log('\n⚠️ 这三个值都不要提交进仓库 —— 仓库是公开的。\n');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('换取失败，看终端');
    console.error(`\n换取 token 失败：${e.message}`);
    server.close();
    process.exit(1);
  }
  server.close();
});

server.listen(PORT, '127.0.0.1');
