// SPDX-License-Identifier: GPL-3.0-or-later
// YouTube backend for the ported UI.
// Same idea as yt2009 (https://github.com/ftde0/yt2009, Apache-2.0): ask InnerTube via youtubei.googleapis.com,
// take the progressive MP4 (itag 18, video+audio in one file) from the ANDROID client and relay it. Nothing is stored on disk.
const https = require('https');
const auth = require('./auth');
const cookieAuth = require('./cookies');

const HOST = 'youtubei.googleapis.com';
const CLIENTS = {
  ANDROID: { ctx: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, osName: 'Android', osVersion: '14', hl: 'en', gl: 'US' }, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' },
  IOS: { ctx: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', gl: 'US' }, ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
  TV: { ctx: { clientName: 'TVHTML5', clientVersion: '7.20250101.16.00', hl: 'en', gl: 'US' }, ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version' },
  WEB: { ctx: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' }, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
};

function post(endpoint, body, client, bearer) {
  const c = CLIENTS[client];
  const data = JSON.stringify({ context: { client: c.ctx }, ...body });
  return new Promise((ok, no) => {
    const r = https.request({ host: HOST, path: `/youtubei/v1/${endpoint}?prettyPrint=false`, method: 'POST', timeout: 15000,
      headers: { 'content-type': 'application/json', 'user-agent': c.ua, 'content-length': Buffer.byteLength(data), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) } }, res => {
      const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString())); } catch (e) { no(e); } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', no); r.end(data);
  });
}

function walk(o, key, out = []) {
  if (Array.isArray(o)) o.forEach(v => walk(v, key, out));
  else if (o && typeof o === 'object') { if (key in o) out.push(o[key]); for (const k in o) walk(o[k], key, out); }
  return out;
}
const text = t => !t ? '' : t.simpleText ?? (t.runs ? t.runs.map(r => r.text).join('') : t.content ?? '');
const num = s => { const m = /([\d,.]+)\s*([KMB])?/i.exec(String(s || '').replace(/,/g, '')); if (!m) return 0; const mul = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1; return Math.round(parseFloat(m[1]) * mul); };
const secs = s => String(s || '').split(':').reduce((a, p) => a * 60 + (+p || 0), 0);

const ownerId = v => ((walk(v.ownerText || v.longBylineText || v.shortBylineText, 'browseEndpoint')[0]) || {}).browseId;
const fromVideoRenderer = v => ({
  id: v.videoId, title: text(v.title), author: text(v.ownerText || v.longBylineText || v.shortBylineText), cid: ownerId(v),
  views: num(text(v.viewCountText)), date: text(v.publishedTimeText), dur: secs(text(v.lengthText)), live: !v.lengthText,
});
function fromLockup(l) {
  if (!l.contentId || l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const md = l.metadata && l.metadata.lockupMetadataViewModel; if (!md) return null;
  const rows = (md.metadata && md.metadata.contentMetadataViewModel && md.metadata.contentMetadataViewModel.metadataRows) || [];
  const parts = rows.flatMap(r => (r.metadataParts || []).map(p => p.text && p.text.content)).filter(Boolean);
  const badge = walk(l.contentImage, 'text').find(t => /^\d+:\d\d/.test(t)) || '';
  return { id: l.contentId, title: md.title.content, author: parts.find(p => !/\bviews?\b|\bago\b|watching|^\d[\d.,]*\s*[KMB]?$/i.test(p)) || '', views: num(parts.find(p => /view/.test(p))), date: parts.find(p => /ago/.test(p)) || '', dur: secs(badge) };
}

// Every list returns { items, next }: `next` is an InnerTube continuation token for the following page (null at the end).
const isCommentsTok = t => Buffer.from(decodeURIComponent(t), 'base64').toString('latin1').includes('comments-section');
async function search(q, cont) {
  const r = await post('search', cont ? { continuation: cont } : { query: q, params: 'EgIQAQ%3D%3D' }, 'WEB');
  return { items: walk(r, 'videoRenderer').map(fromVideoRenderer).filter(v => v.id), next: walk(r, 'continuationCommand').map(c => c.token).pop() || null };
}
async function related(cont) {
  const r = await post('next', { continuation: cont }, 'WEB');
  const items = walk(r, 'lockupViewModel').map(fromLockup).concat(walk(r, 'compactVideoRenderer').map(fromVideoRenderer)).filter(Boolean);
  return { items, next: walk(r, 'continuationCommand').map(c => c.token).filter(t => !isCommentsTok(t)).pop() || null };
}

async function video(id) {
  const [nx, pl] = await Promise.all([post('next', { videoId: id }, 'WEB'), post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID').catch(() => ({}))]);
  const vd = pl.videoDetails || {}; const prim = walk(nx, 'videoPrimaryInfoRenderer')[0] || {}; const sec = walk(nx, 'videoSecondaryInfoRenderer')[0] || {};
  const related = walk(nx, 'lockupViewModel').map(fromLockup).concat(walk(nx, 'compactVideoRenderer').map(fromVideoRenderer)).filter(Boolean);
  const lm = /like this video along with ([\d,]+) other/.exec(JSON.stringify(prim)); const likes = lm ? num(lm[1]) + 1 : 0;
  const owner = (sec.owner && sec.owner.videoOwnerRenderer) || {};
  const lc = walk(nx, 'liveChatRenderer')[0];
  const chat = lc ? { replay: !!lc.isReplay, token: walk(lc.continuations, 'continuation')[0] || null } : null;
  const toks = walk(nx, 'continuationCommand').map(c => c.token);
  const token = toks.find(isCommentsTok), relatedNext = toks.filter(t => !isCommentsTok(t)).pop() || null;
  return {
    id, title: vd.title || text(prim.title), author: vd.author || text(owner.title), channelId: vd.channelId || (owner.navigationEndpoint && owner.navigationEndpoint.browseEndpoint && owner.navigationEndpoint.browseEndpoint.browseId),
    views: num(vd.viewCount) || num(text(prim.viewCount && prim.viewCount.videoViewCountRenderer && prim.viewCount.videoViewCountRenderer.viewCount)), dur: +vd.lengthSeconds || 0,
    date: text(prim.dateText) || '', desc: vd.shortDescription || text(sec.attributedDescription) || '', tags: (vd.keywords || []).join(', '), likes, dislikes: 0,
    live: !!vd.isLive || !!(pl.streamingData && pl.streamingData.hlsManifestUrl) || !!vd.isLiveContent && !vd.lengthSeconds, category: '', playable: !!(pl.playabilityStatus && pl.playabilityStatus.status === 'OK'), reason: pl.playabilityStatus && pl.playabilityStatus.reason || '', related, relatedNext, commentsToken: token || null, chat: chat && chat.token ? chat : null,
  };
}

async function comments(token) {
  const r = await post('next', { continuation: token }, 'WEB');
  const ents = walk(r, 'commentEntityPayload');
  const items = ents.length ? ents.map(e => ({ author: (e.author && e.author.displayName) || '', text: (e.properties && e.properties.content && e.properties.content.content) || '', time: (e.properties && e.properties.publishedTime) || '' })).filter(c => c.text)
    : walk(r, 'commentRenderer').map(c => ({ author: text(c.authorText), text: text(c.contentText), time: text(c.publishedTimeText) }));
  // the last continuationItemRenderer of the list is "more comments"; reply threads use other tokens and are skipped
  const next = walk(r, 'continuationItemRenderer').map(c => (walk(c, 'continuationCommand')[0] || {}).token).filter(Boolean).pop() || null;
  return { items, next };
}

// ---- stream relay ----
const urlCache = new Map(); // id -> { url, exp }
async function streamUrl(id, force) {
  const c = urlCache.get(id);
  if (!force && c && c.exp > Date.now()) return c.url;
  const pl = await post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID');
  const f = ((pl.streamingData || {}).formats || []).filter(x => x.url).sort((a, b) => (b.itag === 18) - (a.itag === 18))[0];
  if (!f) throw new Error((pl.playabilityStatus && pl.playabilityStatus.reason) || 'no progressive format');
  urlCache.set(id, { url: f.url, exp: Date.now() + 20 * 60 * 1000 });
  return f.url;
}
function relay(url, req, res, retry, ua) {
  const u = new URL(url);
  const headers = { 'user-agent': ua || CLIENTS.ANDROID.ua, accept: '*/*' };
  if (req.headers.range) headers.range = req.headers.range;
  const hops = (req.__hops = (req.__hops || 0) + 1);
  const up = https.get({ host: u.host, path: u.pathname + u.search, headers, timeout: 20000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 5) {   // googlevideo redirects long videos to another host
      r.resume(); const next = new URL(r.headers.location, url);
      if (!HOST_OK.test(next.hostname)) { res.writeHead(502); return res.end(); }
      return relay(next.href, req, res, retry, ua);
    }
    if (r.statusCode === 403 && retry) { r.resume(); return retry(); }
    const h = { 'content-type': r.headers['content-type'] || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    if (r.headers['content-type'] === 'application/octet-stream') h['content-type'] = 'video/mp4';
    for (const k of ['content-length', 'content-range']) if (r.headers[k]) h[k] = r.headers[k];
    res.writeHead(r.statusCode, h); r.pipe(res);
    res.on('close', () => up.destroy());
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
}
async function stream(id, req, res) {
  try {
    const url = await streamUrl(id);
    relay(url, req, res, async () => { try { relay(await streamUrl(id, true), req, res); } catch (e) { res.writeHead(502); res.end(); } });
  } catch (e) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(String(e.message || e)); }
}
function thumb(id, res) {
  https.get({ host: 'i.ytimg.com', path: `/vi/${id}/mqdefault.jpg`, headers: { 'user-agent': CLIENTS.WEB.ua } }, r => {
    res.writeHead(r.statusCode, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); r.pipe(res);
  }).on('error', () => { res.writeHead(502); res.end(); });
}

// ---- live streams (HLS), relayed through us so the browser needs no CORS/headers ----
const HOST_OK = /(^|\.)(googlevideo\.com|youtube\.com|ytimg\.com)$/;
const b64u = s => Buffer.from(s).toString('base64url');
function getText(url, ua) {
  return new Promise((ok, no) => { https.get(url, { headers: { 'user-agent': ua || CLIENTS.ANDROID.ua }, timeout: 15000 }, r => { const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => ok({ status: r.statusCode, type: r.headers['content-type'] || '', body: Buffer.concat(ch) })); }).on('error', no); });
}
// Keep only H.264 variants (every phone and Safari can decode them) and, when `h` is given, only that height.
// Audio tracks of an HLS master (dubbed languages, original...). YouTube tags each with YT-EXT-AUDIO-CONTENT-ID.
const attr = (l, k) => ((new RegExp(k + '="([^"]*)"')).exec(l) || [])[1];
function audioOf(txt) {
  const seen = new Map();
  for (const l of txt.split('\n')) if (l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l)) {
    const id = attr(l, 'YT-EXT-AUDIO-CONTENT-ID') || attr(l, 'LANGUAGE') || attr(l, 'NAME'); if (!id || seen.has(id)) continue;
    seen.set(id, { id, name: attr(l, 'NAME') || id, lang: attr(l, 'LANGUAGE') || '', def: /DEFAULT=YES/.test(l) });
  }
  return [...seen.values()];
}
// a = audio content id: keep only that track in every audio group (marked DEFAULT) so every player, Safari included, uses it.
function filterMaster(txt, h, a) {
  if (a) {
    const groups = {}; txt.split('\n').forEach(l => { if (l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l)) (groups[attr(l, 'GROUP-ID')] = groups[attr(l, 'GROUP-ID')] || []).push(l); });
    const keep = new Set(); for (const g in groups) { const m = groups[g].find(l => (attr(l, 'YT-EXT-AUDIO-CONTENT-ID') || attr(l, 'LANGUAGE')) === a); if (m) keep.add(m); else groups[g].filter(l => /DEFAULT=YES/.test(l)).forEach(l => keep.add(l)); }
    txt = txt.split('\n').filter(l => !(l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l)) || keep.has(l)).map(l => keep.has(l) ? l.replace('DEFAULT=NO', 'DEFAULT=YES') : l).join('\n');
  }
  const lines = txt.split('\n'), out = [];
  if (h) { const hs = heightsOf(txt); if (hs.length && !hs.includes(h)) h = hs.find(x => x <= h) || hs[hs.length - 1]; }   // nearest available height
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-STREAM-INF')) {
      const uri = lines[i + 1]; i++;
      const codecs = (/CODECS="([^"]+)"/.exec(l) || [])[1] || '', res = +((/RESOLUTION=\d+x(\d+)/.exec(l) || [])[1] || 0);
      if (codecs && !/avc1/.test(codecs)) continue;
      if (h && res !== h) continue;
      out.push(l, uri);
    } else out.push(l);
  }
  return out.join('\n');
}
const heightsOf = txt => [...new Set([...txt.matchAll(/#EXT-X-STREAM-INF:[^\n]*/g)].filter(m => !/CODECS="(?![^"]*avc1)/.test(m[0])).map(m => +((/RESOLUTION=\d+x(\d+)/.exec(m[0]) || [])[1] || 0)).filter(Boolean))].sort((a, b) => b - a);
function rewriteM3u8(txt, base) {
  const px = u => '/hlsp?u=' + b64u(new URL(u, base).href);
  return txt.split('\n').map(l => { l = l.trimEnd(); if (!l) return l; if (l[0] === '#') return l.replace(/URI="([^"]+)"/g, (m, u) => `URI="${px(u)}"`); return px(l); }).join('\n');
}
async function hlsMaster(id, res, h, a) {
  try {
    const pl = await post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID');
    const m = pl.streamingData && pl.streamingData.hlsManifestUrl; if (!m) throw new Error((pl.playabilityStatus && pl.playabilityStatus.reason) || 'not a live stream');
    const r = await getText(m);
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }); res.end(rewriteM3u8(filterMaster(r.body.toString(), h, a), m));
  } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
}
function hlsProxy(token, req, res) {
  let url; try { url = new URL(Buffer.from(token, 'base64url').toString()); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.protocol !== 'https:' || !HOST_OK.test(url.hostname)) { res.writeHead(403); return res.end(); }
  https.get(url, { headers: { 'user-agent': CLIENTS.ANDROID.ua }, timeout: 20000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return hlsProxy(b64u(new URL(r.headers.location, url).href), req, res); }
    const type = r.headers['content-type'] || '';
    if (/mpegurl/i.test(type) || (url.hostname === 'manifest.googlevideo.com' && /\/api\/manifest\//.test(url.pathname))) {
      const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => { res.writeHead(r.statusCode, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }); res.end(rewriteM3u8(Buffer.concat(ch).toString(), url.href)); });
    } else { res.writeHead(r.statusCode, { 'content-type': type || 'video/mp2t', 'cache-control': 'no-store' }); r.pipe(res); res.on('close', () => r.destroy()); }
  }).on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
}

// ---- signed-in features (TV client + OAuth bearer) ----
function fromTile(t) {
  const m = t.metadata && t.metadata.tileMetadataRenderer; if (!m || !t.contentId) return null;
  const lines = (m.lines || []).map(l => walk(l, 'text').map(text).join(' ').trim()).filter(Boolean);
  const dur = (walk(t.header, 'thumbnailOverlayTimeStatusRenderer')[0] || {}).text;
  const views = lines.join(' ').match(/([\d.,]+\s*[KMB]?)\s+views/i);
  return { id: t.contentId, title: text(m.title), author: lines[0] || '', views: views ? num(views[1]) : 0, date: (lines.join(' ').match(/(\d+\s+\w+\s+ago|Streamed.*|Premiered.*)/) || [''])[0], dur: secs(text(dur)), live: !!(walk(t.header, 'thumbnailOverlayTimeStatusRenderer')[0] || {}).style && /LIVE/.test((walk(t.header, 'thumbnailOverlayTimeStatusRenderer')[0] || {}).style) };
}
async function home(cont) {
  if (cookieAuth.has()) {
    const r = await cookieAuth.post('browse', cont ? { continuation: cont } : { browseId: 'FEwhat_to_watch' });
    const items = walk(r, 'videoRenderer').map(fromVideoRenderer).concat(walk(r, 'lockupViewModel').map(fromLockup)).filter(v => v && v.id);
    if (items.length || cont) return { items, next: walk(r, 'continuationCommand').map(c => c.token).pop() || null };
  }
  const tok = await auth.token(); if (!tok) return null;
  const r = await post('browse', cont ? { continuation: cont } : { browseId: 'FEwhat_to_watch' }, 'TV', tok);
  const items = walk(r, 'tileRenderer').filter(t => t.contentType === 'TILE_CONTENT_TYPE_VIDEO').map(fromTile).filter(Boolean);
  // TV home = vertical list of shelves; the LAST nextContinuationData belongs to the vertical list (the others scroll a shelf sideways)
  return { items, next: (walk(r, 'nextContinuationData').pop() || {}).continuation || null };
}
async function account() {
  const tok = await auth.token(); if (!tok) return null;
  const cached = auth.profile(); if (cached) return cached;
  try {
    const r = await post('account/accounts_list', {}, 'TV', tok);
    const it = walk(r, 'accountItem')[0]; if (!it) return { name: 'Google account' };
    const p = { name: text(it.accountName) || 'Google account', photo: (it.accountPhoto && it.accountPhoto.thumbnails && it.accountPhoto.thumbnails[0] && it.accountPhoto.thumbnails[0].url) || '' };
    auth.setProfile(p); return p;
  } catch (e) { return { name: 'Google account' }; }
}

// ---- quality choice for normal videos ----
// Full-length streams above 360p need YouTube's anti-bot tokens. yt-dlp solves them (with node as its JS runtime) and returns an
// HLS master playlist that has every quality up to 1080p+. We start it once per video and cache the result for 3 hours.
const { execFile } = require('child_process');
const path = require('path');
const qCache = new Map();   // id -> Promise<{ manifest, heights, exp }>
function ytdlpManifest(id) {
  const c = qCache.get(id); if (c && c.exp > Date.now()) return c.p;
  const p = new Promise((ok, no) => {
    const env = { ...process.env, PYTHONPATH: path.join(__dirname, 'tools', 'ytdlp-shim') + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '') };
    execFile(process.env.YTDLP || 'yt-dlp', ['--js-runtimes', 'node', '--no-warnings', '--no-playlist', '-j', 'https://www.youtube.com/watch?v=' + id], { env, timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, async (err, out) => {
      if (err) return no(new Error('yt-dlp: ' + String(err.message).split('\n').slice(-2).join(' ')));
      try {
        const d = JSON.parse(out);
        const manifest = (d.formats || []).map(f => f.manifest_url).find(u => u && /hls_variant/.test(u));
        if (!manifest) return no(new Error('no HLS formats'));
        const r = await getText(manifest);
        const t = r.body.toString(); ok({ manifest, heights: heightsOf(t), audio: audioOf(t) });
      } catch (e) { no(e); }
    });
  });
  qCache.set(id, { p, exp: Date.now() + 3 * 3600 * 1000 });
  p.catch(() => qCache.delete(id));
  return p;
}
async function qualities(id) { const q = await ytdlpManifest(id); return { heights: q.heights, audio: q.audio }; }
async function qualityMaster(id, h, a, res) {
  try {
    const q = await ytdlpManifest(id);
    const r = await getText(q.manifest);
    if (r.status !== 200) { qCache.delete(id); throw new Error('manifest ' + r.status); }
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }); res.end(rewriteM3u8(filterMaster(r.body.toString(), h, a), q.manifest));
  } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
}
async function liveQualities(id) {
  const pl = await post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID');
  const m = pl.streamingData && pl.streamingData.hlsManifestUrl; if (!m) return { heights: [] };
  const t = (await getText(m)).body.toString(); return { heights: heightsOf(t), audio: audioOf(t) };
}

// ---- live chat (live streams and stream recordings) ----
const runsText = runs => (runs || []).map(r => r.text != null ? r.text : (r.emoji ? (r.emoji.isCustomEmoji ? (r.emoji.shortcuts || [''])[0] : r.emoji.emojiId) : '')).join('');
function chatItem(a) {
  const m = a.liveChatTextMessageRenderer || a.liveChatPaidMessageRenderer; if (!m) return null;
  return { id: m.id, author: text(m.authorName), text: runsText(m.message && m.message.runs), paid: m.purchaseAmountText ? text(m.purchaseAmountText) : '',
    owner: !!(m.authorBadges || []).find(b => /OWNER/.test(JSON.stringify(b))), mod: !!(m.authorBadges || []).find(b => /MODERATOR/.test(JSON.stringify(b))) };
}
async function chatPage(token, replayMs) {
  const replay = replayMs != null;
  const r = await post(replay ? 'live_chat/get_live_chat_replay' : 'live_chat/get_live_chat', replay ? { continuation: token, currentPlayerState: { playerOffsetMs: String(Math.max(0, replayMs | 0)) } } : { continuation: token }, 'WEB');
  const items = [];
  if (replay) for (const ra of walk(r, 'replayChatItemAction')) { const off = +ra.videoOffsetTimeMsec || 0; for (const it of walk(ra.actions, 'item')) { const c = chatItem(it); if (c) items.push({ ...c, ms: off }); } }
  else for (const it of walk(walk(r, 'addChatItemAction'), 'item')) { const c = chatItem(it); if (c) items.push(c); }
  const cd = (walk(r, 'continuations')[0] || [])[0] || {};
  const k = cd.invalidationContinuationData || cd.timedContinuationData || cd.liveChatReplayContinuationData || cd.reloadContinuationData || {};
  return { items, next: k.continuation || null, timeoutMs: k.timeoutMs || 5000 };
}

// ---- posting (needs Google sign-in) ----
// createCommentParams is a small protobuf { 2: videoId, 5: { 1: 0 }, 10: 7 }, the same message the YouTube apps send.
function commentParams(id) {
  const vid = Buffer.from(id);
  return encodeURIComponent(Buffer.concat([Buffer.from([0x12, vid.length]), vid, Buffer.from([0x2a, 0x02, 0x08, 0x00, 0x50, 0x07])]).toString('base64'));
}
const ok = r => r && !r.error && (r.actionResult ? r.actionResult.status === 'STATUS_SUCCEEDED' : !!(r.actions && r.actions.length));
async function postAuthed(endpoint, body) {
  const tok = await auth.token(); if (!tok) { const e = new Error('Sign in to post'); e.code = 401; throw e; }
  let last;
  if (process.env.YTWEB_DEBUG) console.log('[post]', endpoint);
  try { const r = await post(endpoint, body, 'TV', tok); if (ok(r)) return r; last = r; } catch (e) { last = { error: { message: e.message } }; }   // only the TV client accepts our OAuth token
  throw new Error('YouTube: ' + ((last && last.error && last.error.message) || 'refused the request'));
}
async function addComment(id, textMsg) {
  if (cookieAuth.has()) {
    const r = await cookieAuth.post('comment/create_comment', { commentText: textMsg, createCommentParams: commentParams(id) });
    if (!ok(r)) throw new Error('YouTube: ' + ((r.error && r.error.message) || 'refused the comment'));
    const m = await me().catch(() => null); return { author: (m && (m.handle || m.name)) || 'You', text: textMsg, time: 'just now' };
  }
  await postAuthed('comment/create_comment', { commentText: textMsg, createCommentParams: commentParams(id) });
  const m = await me().catch(() => null); return { author: (m && (m.handle || m.name)) || 'You', text: textMsg, time: 'just now' };
}
async function sendChat(id, textMsg) {
  if (cookieAuth.has()) return sendChatCookies(id, textMsg);
  const tok = await auth.token(); if (!tok) { const e = new Error('Add YouTube cookies in Settings to chat'); e.code = 401; throw e; }
  // Only the TV client accepts our OAuth token, and the TV app has no chat box, so YouTube never hands us the
  // "send" params. We build them like YouTube.js (LuanRT/YouTube.js, LiveChat.sendMessage, MIT):
  // protobuf { 1: { 5: { 1: channelId, 2: videoId } }, 2: 1, 3: 4 } -> base64 -> encodeURIComponent -> base64 again.
  const pl = await post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID');
  const ch = pl.videoDetails && pl.videoDetails.channelId; if (!ch) throw new Error('channel not found');
  const fld = (n, b) => Buffer.concat([Buffer.from([(n << 3) | 2, b.length]), b]);
  const proto = Buffer.concat([fld(1, fld(5, Buffer.concat([fld(1, Buffer.from(ch)), fld(2, Buffer.from(id))]))), Buffer.from([0x10, 0x01, 0x18, 0x04])]);
  const params = Buffer.from(encodeURIComponent(proto.toString('base64'))).toString('base64');
  const cmid = require('crypto').randomUUID();
  const r = await post('live_chat/send_message', { params, clientMessageId: cmid, richMessage: { textSegments: [{ text: textMsg }] } }, 'TV', tok);
  if (process.env.YTWEB_DEBUG) console.log('[chat send]', JSON.stringify(r).slice(0, 500));
  if (r.error && r.error.status === 'FAILED_PRECONDITION') { const e = new Error('YouTube does not let the TV sign-in chat. Add YouTube cookies in Settings.'); e.code = 401; throw e; }
  if (r.error) throw new Error('YouTube: ' + r.error.message + ' (' + (r.error.status || r.error.code) + ')');
  if (!(r.actions && r.actions.length)) throw new Error('YouTube did not accept the message');
  const p = auth.profile(); return { author: (p && p.name) || 'You', text: textMsg };
}

// ---- live DVR: rewind inside a stream and jump back to live ----
// YouTube's live HLS manifest only covers the last 30 s. The DASH (adaptive) URLs of a live stream accept &sq=N for any
// 5-second segment in the DVR window (up to 12 h), and each segment is a complete fMP4 file (ftyp+moov+moof+mdat).
// We describe them as an HLS playlist: one init segment (ftyp+moov) and media segments with the init part cut off.
// How far back: everything YouTube still keeps (often the whole stream), capped at DVR_MAX_HOURS (default 24 h)
// so the playlist stays small enough for phones.
const DVR_CAP = Math.max(60, Math.round((+process.env.DVR_MAX_HOURS || 24) * 3600 / 5));
const dvrCache = new Map();   // id -> { exp, fmts: {itag: fmt}, video: [fmt], audio: fmt, head, headAt, target }
async function dvrInfo(id) {
  const c = dvrCache.get(id); if (c && c.exp > Date.now()) return c;
  const pl = await post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID');
  const ad = ((pl.streamingData || {}).adaptiveFormats || []).filter(f => f.url);
  if (!((pl.videoDetails && pl.videoDetails.isLive) || (pl.streamingData && pl.streamingData.hlsManifestUrl)) || !ad.length) throw new Error('not a live stream with DVR');
  const video = ad.filter(f => /^video\/mp4/.test(f.mimeType) && /avc1/.test(f.mimeType)).sort((a, b) => a.height - b.height);
  const audio = ad.find(f => f.itag === 140) || ad.find(f => /^audio\/mp4/.test(f.mimeType));
  if (!video.length || !audio) throw new Error('no H.264 live formats');
  const fmts = {}; [...video, audio].forEach(f => fmts[f.itag] = f);
  const info = { exp: Date.now() + 60 * 60 * 1000, fmts, video, audio, head: 0, headAt: 0, target: (video[0].targetDurationSec || 5), init: {} };
  dvrCache.set(id, info); return info;
}
function headSeq(info) {
  if (Date.now() - info.headAt < 2000) return Promise.resolve(info.head);
  const u = new URL(info.audio.url + '&sq=0');
  return new Promise((ok, no) => {
    const r = https.request({ host: u.host, path: u.pathname + u.search, method: 'HEAD', headers: { 'user-agent': CLIENTS.ANDROID.ua }, timeout: 10000 }, res => {
      res.resume(); const h = +res.headers['x-head-seqnum'];
      if (!h) return no(new Error('no head sequence (' + res.statusCode + ')'));
      info.head = h; info.headAt = Date.now(); ok(h);
    });
    r.on('error', no); r.on('timeout', () => r.destroy(new Error('timeout'))); r.end();
  });
}
function fetchBuf(url) {
  return new Promise((ok, no) => https.get(url, { headers: { 'user-agent': CLIENTS.ANDROID.ua }, timeout: 20000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return fetchBuf(new URL(r.headers.location, url).href).then(ok, no); }
    const b = []; r.on('data', d => b.push(d)); r.on('end', () => r.statusCode < 300 ? ok(Buffer.concat(b)) : no(new Error('segment ' + r.statusCode)));
  }).on('error', no));
}
// offset of the first box after ftyp/moov (where the media part starts)
function mediaStart(buf) { let p = 0; while (p + 8 <= buf.length) { const size = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8); if (type !== 'ftyp' && type !== 'moov') return p; if (size < 8) break; p += size; } return 0; }
const mpeg = 'application/vnd.apple.mpegurl';
async function dvrMaster(id, h, res) {
  try {
    const d = await dvrInfo(id); await headSeq(d);
    let vids = d.video; if (h) { const hs = vids.map(f => f.height); const pick = hs.includes(h) ? h : (hs.filter(x => x <= h).pop() || hs[0]); vids = vids.filter(f => f.height === pick); }
    const cod = f => (/codecs="([^"]+)"/.exec(f.mimeType) || [])[1];
    const out = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="/ldvr/${id}/${d.audio.itag}.m3u8"`];
    for (const f of vids) out.push(`#EXT-X-STREAM-INF:BANDWIDTH=${(f.bitrate || 1e6) + (d.audio.bitrate || 128000)},RESOLUTION=${f.width}x${f.height},CODECS="${cod(f)},${cod(d.audio)}",AUDIO="a"`, `/ldvr/${id}/${f.itag}.m3u8`);
    res.writeHead(200, { 'content-type': mpeg, 'cache-control': 'no-store' }); res.end(out.join('\n') + '\n');
  } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
}
function segAvailable(info, sq) {
  const u = new URL(info.audio.url + '&sq=' + sq);
  return new Promise(ok => { const r = https.get({ host: u.host, path: u.pathname + u.search, headers: { 'user-agent': CLIENTS.ANDROID.ua, range: 'bytes=0-0' }, timeout: 10000 }, res => { res.resume(); ok(res.statusCode < 300); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });
}
// oldest segment YouTube still serves, found by binary search once and cached for 10 minutes
async function oldestSeq(info, head) {
  if (info.oldest != null && Date.now() - info.oldestAt < 600000) return Math.max(info.oldest, head - DVR_CAP + 1);
  let lo = Math.max(0, head - DVR_CAP + 1);
  if (!(await segAvailable(info, lo))) { let a = lo, b = head; while (b - a > 1) { const m = (a + b) >> 1; if (await segAvailable(info, m)) b = m; else a = m; } lo = b; }
  info.oldest = lo; info.oldestAt = Date.now(); return lo;
}
function sendPlaylist(req, res, text) {
  const h = { 'content-type': mpeg, 'cache-control': 'no-store' };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { h['content-encoding'] = 'gzip'; res.writeHead(200, h); return res.end(require('zlib').gzipSync(text)); }
  res.writeHead(200, h); res.end(text);
}
async function dvrMedia(id, itag, res, req) {
  try {
    const d = await dvrInfo(id); if (!d.fmts[itag]) { res.writeHead(404); return res.end(); }
    const head = await headSeq(d), first = await oldestSeq(d, head), T = d.target;
    const out = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${T}`, `#EXT-X-MEDIA-SEQUENCE:${first}`, '#EXT-X-INDEPENDENT-SEGMENTS', `#EXT-X-MAP:URI="/lseg/${id}/${itag}/init"`];
    // the newest segment may still be growing, so the list ends one before the head
    for (let sq = first; sq < head; sq++) out.push(`#EXTINF:${T}.0,`, `/lseg/${id}/${itag}/${sq}`);   // ~35 bytes each, gzip makes it ~10x smaller
    sendPlaylist(req, res, out.join('\n') + '\n');
  } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
}
async function dvrSegment(id, itag, sq, res) {
  try {
    const d = await dvrInfo(id); const f = d.fmts[itag]; if (!f) { res.writeHead(404); return res.end(); }
    if (sq === 'init') {
      if (!d.init[itag]) { const head = await headSeq(d); const b = await fetchBuf(f.url + '&sq=' + Math.max(0, head - 1)); d.init[itag] = b.subarray(0, mediaStart(b)); }
      res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'max-age=3600' }); return res.end(d.init[itag]);
    }
    const b = await fetchBuf(f.url + '&sq=' + (+sq));
    res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'max-age=3600' }); res.end(b.subarray(mediaStart(b)));
  } catch (e) { if (/40[34]/.test(e.message)) dvrCache.delete(id); res.writeHead(502); res.end(String(e.message || e)); }
}

// Sending with youtube.com cookies (WEB client). The send params come from the signed-in chat itself when possible.
function sendParamsFor(ch, id) {
  const fld = (n, b) => Buffer.concat([Buffer.from([(n << 3) | 2, b.length]), b]);
  const proto = Buffer.concat([fld(1, fld(5, Buffer.concat([fld(1, Buffer.from(ch)), fld(2, Buffer.from(id))]))), Buffer.from([0x10, 0x01, 0x18, 0x04])]);
  return Buffer.from(encodeURIComponent(proto.toString('base64'))).toString('base64');
}
async function sendChatCookies(id, textMsg) {
  let params = null;
  try {
    const nx = await cookieAuth.post('next', { videoId: id });
    const lc = walk(nx, 'liveChatRenderer')[0]; const ct = lc && walk(lc.continuations, 'continuation')[0];
    if (ct) {
      const lr = await cookieAuth.post('live_chat/get_live_chat', { continuation: ct });
      params = (walk(lr, 'sendLiveChatMessageEndpoint')[0] || {}).params || null;
      const restricted = walk(lr, 'liveChatRestrictedParticipationRenderer')[0];
      if (!params && restricted) throw new Error(text(restricted.message) || 'Chat is restricted for this account');
    }
  } catch (e) { if (/restricted|subscribers|members/i.test(e.message)) throw e; }
  if (!params) {
    const pl = await post('player', { videoId: id, contentCheckOk: true, racyCheckOk: true }, 'ANDROID');
    const ch = pl.videoDetails && pl.videoDetails.channelId; if (!ch) throw new Error('channel not found');
    params = sendParamsFor(ch, id);
  }
  const r = await cookieAuth.post('live_chat/send_message', { params, clientMessageId: require('crypto').randomUUID(), richMessage: { textSegments: [{ text: textMsg }] } });
  if (process.env.YTWEB_DEBUG) console.log('[chat send, cookies]', JSON.stringify(r).slice(0, 500));
  if (r.error) throw new Error('YouTube: ' + r.error.message + ' (' + (r.error.status || r.error.code) + ')');
  if (!(r.actions && r.actions.length)) throw new Error('YouTube did not accept the message');
  return { author: cookieAuth.name() || 'You', text: textMsg };
}

// ---- channels and the signed-in user's own channel ----
const CH_TABS = { videos: 'EgZ2aWRlb3PyBgQKAjoA', live: 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D', playlists: 'EglwbGF5bGlzdHPyBgQKAkIA' };
const firstUrl = o => (JSON.stringify(o || {}).match(/"url":"(https:\/\/yt3\.[^"]+)"/) || [])[1] || '';
function fromPlaylistLockup(l) {
  if (!l.contentId || !/PLAYLIST|PODCAST/.test(l.contentType || '')) return null;
  const md = l.metadata && l.metadata.lockupMetadataViewModel; const count = walk(l.contentImage, 'text').find(t => /video|episode/i.test(t)) || '';
  return { pid: l.contentId, title: md ? md.title.content : '', count };
}
async function channelHeader(cid) {
  const c = await post('browse', { browseId: cid }, 'WEB');
  const hv = walk(c, 'pageHeaderViewModel')[0], md = (c.metadata || {}).channelMetadataRenderer || {};
  const rows = walk(hv, 'metadataRows').flat().map(r => (r.metadataParts || []).map(p => p.text && p.text.content).filter(Boolean)).flat();
  const subs = rows.find(x => /subscriber/i.test(x)) || '', vids = rows.find(x => /video/i.test(x)) || '';
  return { cid, title: md.title || (walk(c, 'pageHeaderRenderer')[0] || {}).pageTitle || '', handle: rows.find(x => /^@/.test(x)) || '', avatar: firstUrl(walk(hv, 'avatarViewModel')[0] || md.avatar),
    subscribers: num(subs), subscribersText: subs, videos: num(vids), videosText: vids, desc: md.description || '' };
}
async function channelTab(cid, tab, cont) {
  const r = await post('browse', cont ? { continuation: cont } : { browseId: cid, params: CH_TABS[tab] || CH_TABS.videos }, 'WEB');
  const next = walk(r, 'continuationCommand').map(c => c.token).pop() || null;
  if (tab === 'playlists') return { items: walk(r, 'lockupViewModel').map(fromPlaylistLockup).filter(Boolean), next };
  const items = walk(r, 'lockupViewModel').map(fromLockup).concat(walk(r, 'videoRenderer').map(fromVideoRenderer)).filter(Boolean).map(v => ({ ...v, cid: v.cid || cid }));
  return { items, next };
}
async function channel(cid) { return channelHeader(cid); }
async function findChannel(name) {
  const r = await post('search', { query: name, params: 'EgIQAg%3D%3D' }, 'WEB');
  const c = walk(r, 'channelRenderer')[0]; return c ? { cid: c.channelId } : null;
}
async function playlist(pid, cont) {
  const r = await post('browse', cont ? { continuation: cont } : { browseId: 'VL' + pid }, 'WEB');
  const items = walk(r, 'playlistVideoRenderer').map(v => ({ id: v.videoId, title: text(v.title), author: text(v.shortBylineText), cid: ownerId({ shortBylineText: v.shortBylineText }), dur: +v.lengthSeconds || secs(text(v.lengthText)), views: 0, date: text(v.videoInfo) }))
    .concat(walk(r, 'lockupViewModel').map(fromLockup)).filter(v => v && v.id);
  const title = text((walk(r, 'playlistHeaderRenderer')[0] || {}).title) || ((walk(r, 'pageHeaderRenderer')[0] || {}).pageTitle) || '';
  return { title, items, next: walk(r, 'continuationCommand').map(c => c.token).pop() || null };
}
// Who is signed in. Cookies (youtube.com) are preferred, then the TV sign-in.
let meCache = null;
async function me() {
  if (meCache && meCache.exp > Date.now()) return meCache.v;
  let v = null;
  if (cookieAuth.has()) {
    try {
      const r = await cookieAuth.post('account/account_menu', {});
      const hdr = walk(r, 'activeAccountHeaderRenderer')[0] || {};
      const cid = (JSON.stringify(r).match(/"browseId":"(UC[\w-]{22})"/) || [])[1];
      v = { method: 'cookies', name: text(hdr.accountName) || cookieAuth.name() || '', handle: text(hdr.channelHandle), avatar: firstUrl(hdr.accountPhoto), cid };
    } catch (e) {}
  }
  if (!v && auth.signedIn()) {
    const tok = await auth.token();
    if (tok) {
      const r = await post('account/accounts_list', {}, 'TV', tok);
      const it = walk(r, 'accountItem').find(a => a.isSelected) || walk(r, 'accountItem')[0] || {};
      const s = JSON.stringify(it);
      let cid = (s.match(/"browseId":"(UC[\w-]{22})"/) || [])[1];
      const handle = text(it.channelHandle) || (s.match(/"(@[\w.-]{3,})"/) || [])[1] || '';
      if (!cid && handle) { try { const rr = await post('navigation/resolve_url', { url: 'https://www.youtube.com/' + handle }, 'WEB'); cid = (walk(rr, 'browseEndpoint')[0] || {}).browseId; } catch (e) {} }
      v = { method: 'tv', name: text(it.accountName) || (auth.profile() || {}).name || 'Google account', handle, avatar: firstUrl(it.accountPhoto) || (auth.profile() || {}).photo || '', cid };
    }
  }
  meCache = { v, exp: Date.now() + 10 * 60 * 1000 }; return v;
}
const forgetMe = () => { meCache = null; };
// liked videos ("LL") and subscriptions need the account
async function liked(cont) {
  const body = cont ? { continuation: cont } : { browseId: 'VLLL' };
  let r;
  if (cookieAuth.has()) r = await cookieAuth.post('browse', body);
  else { const tok = await auth.token(); if (!tok) return { items: [], next: null }; r = await post('browse', body, 'TV', tok); }
  const items = walk(r, 'playlistVideoRenderer').map(v => ({ id: v.videoId, title: text(v.title), author: text(v.shortBylineText), dur: +v.lengthSeconds || 0, views: 0, date: '' }))
    .concat(walk(r, 'tileRenderer').filter(t => t.contentType === 'TILE_CONTENT_TYPE_VIDEO').map(fromTile)).filter(v => v && v.id);
  return { items, next: walk(r, 'continuationCommand').map(c => c.token).concat(walk(r, 'nextContinuationData').map(c => c.continuation)).pop() || null };
}
async function subscriptions(cont) {
  let r;
  if (cookieAuth.has()) r = await cookieAuth.post('browse', cont ? { continuation: cont } : { browseId: 'FEchannels' });
  else { const tok = await auth.token(); if (!tok) return { items: [], next: null }; r = await post('browse', cont ? { continuation: cont } : { browseId: 'FEchannels' }, 'TV', tok); }
  const items = walk(r, 'channelRenderer').map(c => ({ cid: c.channelId, title: text(c.title), avatar: firstUrl(c.thumbnail) }))
    .concat(walk(r, 'tileRenderer').filter(t => /CHANNEL/.test(t.contentType || '')).map(t => ({ cid: t.contentId, title: text(t.metadata && t.metadata.tileMetadataRenderer && t.metadata.tileMetadataRenderer.title), avatar: firstUrl(t.header) })))
    .filter(c => c.cid && c.title);
  return { items, next: walk(r, 'continuationCommand').map(c => c.token).concat(walk(r, 'nextContinuationData').map(c => c.continuation)).pop() || null };
}

// avatars: yt3 refuses requests with a foreign Referer (429), so they go through the server
function avatar(token, res) {
  let u; try { u = new URL(Buffer.from(token, 'base64url').toString()); } catch (e) { res.writeHead(400); return res.end(); }
  if (u.protocol !== 'https:' || !/^yt3\.(ggpht|googleusercontent)\.com$/.test(u.hostname)) { res.writeHead(403); return res.end(); }
  https.get(u, { headers: { 'user-agent': CLIENTS.WEB.ua }, timeout: 15000 }, r => { res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'image/jpeg', 'cache-control': 'public, max-age=86400' }); r.pipe(res); })
    .on('error', () => { res.writeHead(502); res.end(); });
}

module.exports = { avatar, channel, channelTab, findChannel, playlist, me, forgetMe, liked, subscriptions, dvrMaster, dvrMedia, dvrSegment, chatPage, addComment, sendChat, qualities, qualityMaster, liveQualities, related, home, account, search, video, comments, stream, thumb, hlsMaster, hlsProxy };
