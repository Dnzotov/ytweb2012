// SPDX-License-Identifier: GPL-3.0-or-later
// Static server for the ported YouTube 3.3.0 UI. Binds to LAN so the phone can open it.
const http = require('http'), fs = require('fs'), path = require('path');
const yt = require('./yt');
const auth = require('./auth');
const crypto = require('crypto');
const PIN = process.env.YT_PIN || '';
const pinCookie = crypto.createHash('sha256').update('ytweb:' + PIN).digest('hex').slice(0, 32);
if (!require('fs').existsSync(require('path').join(__dirname, 'public', 'apps', 'v22', 'res', 'layout'))) {
  console.error('\nUI resources are missing. Extract them from the original APK first:\n  node tools/extract-res.js <youtube-2.2.14.apk> v22\n');
  process.exit(1);
}
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css',
  '.png':'image/png', '.xml':'text/xml; charset=utf-8', '.woff2':'font/woff2', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.mp4':'video/mp4', '.jpg':'image/jpeg', '.ttf':'font/ttf' };
http.createServer((req, res) => {
  const mi = /^\/apps\/(\w+)\/res-index\.json$/.exec(req.url);
  if (mi) {
    const out = {}; const base = path.join(ROOT, 'apps', mi[1], 'res');
    for (const d of fs.readdirSync(base)) out[d] = fs.readdirSync(path.join(base, d));
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
  }
  const u = new URL(req.url, 'http://x');
  if (PIN && !(req.headers.cookie || '').includes('ytpin=' + pinCookie)) {   // optional access PIN
    if (req.method === 'POST' && u.pathname === '/pin') { let b = ''; req.on('data', d => b += d); req.on('end', () => { const ok = new URLSearchParams(b).get('pin') === PIN; res.writeHead(ok ? 302 : 401, ok ? { 'Set-Cookie': `ytpin=${pinCookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, Location: '/' } : { 'Content-Type': 'text/html' }); res.end(ok ? '' : 'Wrong PIN. <a href="/">Back</a>'); }); return; }
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<meta name=viewport content="width=device-width"><body style="background:#000;color:#fff;font:18px sans-serif;text-align:center;padding-top:30vh"><form method=post action=/pin>PIN<br><br><input name=pin type=password inputmode=numeric autofocus style="font-size:22px;text-align:center"><br><br><button style="font-size:18px">OK</button></form>');
  } const ID = /^[\w-]{11}$/;
  const json = async fn => { try { const d = await fn(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)); } catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); } };
  if (u.pathname === '/api/search') return json(() => yt.search(u.searchParams.get('q') || '', u.searchParams.get('c')));
  if (u.pathname === '/api/video' && ID.test(u.searchParams.get('id'))) return json(() => yt.video(u.searchParams.get('id')));
  if (u.pathname === '/api/related' && u.searchParams.get('c')) return json(() => yt.related(u.searchParams.get('c')));
  if (u.pathname === '/api/chat' && u.searchParams.get('t')) return json(() => yt.chatPage(u.searchParams.get('t'), u.searchParams.has('ms') ? +u.searchParams.get('ms') : null));
  if (req.method === 'POST' && (u.pathname === '/api/comment' || u.pathname === '/api/chat/send')) {
    let b = ''; req.on('data', d => { b += d; if (b.length > 20000) req.destroy(); });
    req.on('end', async () => {
      let d = {}; try { d = JSON.parse(b); } catch (e) {}
      const textMsg = String(d.text || '').trim().slice(0, u.pathname === '/api/comment' ? 10000 : 200);
      if (!ID.test(d.id || '') || !textMsg) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"bad request"}'); }
      try { const r = await (u.pathname === '/api/comment' ? yt.addComment(d.id, textMsg) : yt.sendChat(d.id, textMsg)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); }
      catch (e) { res.writeHead(e.code === 401 ? 401 : 502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); }
    });
    return;
  }
  if (u.pathname === '/api/comments' && u.searchParams.get('t')) return json(() => yt.comments(u.searchParams.get('t')));
  let m;
  if (u.pathname === '/api/auth/status') return json(async () => ({ signedIn: auth.signedIn(), profile: auth.signedIn() ? await yt.account() : null }));
  if (u.pathname === '/api/auth/start' && req.method === 'POST') return json(() => auth.start());
  if (u.pathname === '/api/auth/poll') return json(() => auth.poll());
  if (u.pathname === '/api/auth/logout' && req.method === 'POST') return json(async () => { await auth.logout(); return { ok: true }; });
  if (u.pathname === '/api/home') return json(async () => {
    const c = u.searchParams.get('c'), kind = u.searchParams.get('k');
    if (kind !== 'search') {
      try { const r = await yt.home(c); if (r && r.items.length) return { personal: true, ...r }; } catch (e) {}
      if (c) return { personal: true, items: [], next: null };   // the personal feed has ended; the client continues with related videos
    }
    const r = await yt.search('trending music videos', kind === 'search' ? c : null); return { personal: false, ...r };
  });
  if ((m = /^\/stream\/([\w-]{11})$/.exec(u.pathname))) return yt.stream(m[1], req, res);
  const hq = +u.searchParams.get('h') || 0;
  const aq = (u.searchParams.get('a') || '').slice(0, 40);
  if ((m = /^\/hls\/([\w-]{11})\.m3u8$/.exec(u.pathname))) return yt.hlsMaster(m[1], res, hq, aq);
  if ((m = /^\/qhls\/([\w-]{11})\.m3u8$/.exec(u.pathname))) return yt.qualityMaster(m[1], hq, aq, res);
  if (u.pathname === '/api/qualities' && ID.test(u.searchParams.get('id'))) return json(() => u.searchParams.get('live') === '1' ? yt.liveQualities(u.searchParams.get('id')) : yt.qualities(u.searchParams.get('id')));
  if (u.pathname === '/hlsp' && u.searchParams.get('u')) return yt.hlsProxy(u.searchParams.get('u'), req, res);
  if ((m = /^\/thumb\/([\w-]{11})$/.exec(u.pathname))) return yt.thumb(m[1], res);
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const h = { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
      return fs.createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { ...h, 'Content-Length': st.size });
    fs.createReadStream(f).pipe(res);
  });
}).listen(process.env.PORT || 8080, process.env.HOST || '127.0.0.1', () => console.log('ytweb on http://' + (process.env.HOST || '127.0.0.1') + ':' + (process.env.PORT || 8080) + (PIN ? ' (PIN required)' : '')));
