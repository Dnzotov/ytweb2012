// SPDX-License-Identifier: GPL-3.0-or-later
// Optional sign-in with youtube.com browser cookies. Only used for things the TV sign-in cannot do (sending live chat).
// The cookies give full access to the Google account. They are kept on THIS server in data/cookies.txt (mode 600),
// never sent anywhere except youtube.com, and never logged.
const https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto'), dns = require('dns');

const FILE = path.join(__dirname, 'data', 'cookies.txt');
const ORIGIN = 'https://www.youtube.com';
const WEB = { clientName: 'WEB', clientVersion: '2.20251101.01.00', hl: 'en', gl: 'US' };
let jar = null, profile = null;
try { jar = parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}

// Accepts a Cookie header ("a=b; c=d") or a Netscape cookies.txt export. Keeps only youtube.com / google.com cookies.
function parse(txt) {
  const out = {};
  txt = String(txt || '').trim();
  if (/\t/.test(txt)) {
    for (const line of txt.split(/\r?\n/)) {
      const l = line.replace(/^#HttpOnly_/, '');
      if (!l || l.startsWith('#')) continue;
      const p = l.split('\t'); if (p.length < 7) continue;
      if (!/(^|\.)youtube\.com$/.test(p[0].replace(/^\./, ''))) continue;
      out[p[5]] = p[6];
    }
  } else {
    for (const part of txt.replace(/^cookie:\s*/i, '').split(';')) {
      const i = part.indexOf('='); if (i < 1) continue;
      out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
  }
  return Object.keys(out).length ? out : null;
}
const header = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const sapisid = () => jar && (jar.SAPISID || jar['__Secure-3PAPISID'] || jar['__Secure-1PAPISID']);
// SAPISIDHASH <time>_<sha1(time + " " + SAPISID + " " + origin)>, the same header youtube.com sends
function authHeader() {
  const t = Math.floor(Date.now() / 1000), sid = sapisid();
  return `SAPISIDHASH ${t}_${crypto.createHash('sha1').update(`${t} ${sid} ${ORIGIN}`).digest('hex')}`;
}

// www.youtube.com does not resolve on some networks; youtube-nocookie.com is the same Google frontend.
function lookup(host, opts, cb) {
  dns.lookup(host, opts, (err, addr, fam) => {
    if (!err || host !== 'www.youtube.com') return cb(err, addr, fam);
    dns.lookup('www.youtube-nocookie.com', opts, cb);
  });
}

function post(endpoint, body) {
  if (!jar || !sapisid()) { const e = new Error('Add YouTube cookies in Settings first'); e.code = 401; return Promise.reject(e); }
  const data = JSON.stringify({ context: { client: WEB }, ...body });
  return new Promise((ok, no) => {
    const r = https.request({ host: 'www.youtube.com', servername: 'www.youtube.com', lookup, path: `/youtubei/v1/${endpoint}?prettyPrint=false`, method: 'POST', timeout: 15000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), cookie: header(), authorization: authHeader(),
        origin: ORIGIN, 'x-origin': ORIGIN, referer: ORIGIN + '/', 'x-goog-authuser': '0', 'x-youtube-client-name': '1', 'x-youtube-client-version': WEB.clientVersion,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' } }, res => {
      const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString())); } catch (e) { no(new Error('YouTube answered ' + res.statusCode)); } });
    });
    r.on('error', no); r.on('timeout', () => r.destroy(new Error('timeout'))); r.end(data);
  });
}

function walk(o, k, out = []) { if (Array.isArray(o)) o.forEach(v => walk(v, k, out)); else if (o && typeof o === 'object') { if (k in o) out.push(o[k]); for (const x in o) walk(o[x], k, out); } return out; }
const text = t => !t ? '' : t.simpleText ?? (t.runs ? t.runs.map(r => r.text).join('') : '');

// Checks the cookies by asking for the account menu; returns the channel name.
async function whoami() {
  const r = await post('account/account_menu', {});
  const name = text(walk(r, 'accountName')[0]) || text(walk(r, 'channelHandle')[0]);
  if (!name) throw new Error((r.error && r.error.message) || 'These cookies are not signed in');
  return name;
}

module.exports = {
  has: () => !!(jar && sapisid()),
  name: () => profile,
  async set(txt) {
    const j = parse(txt); if (!j || !(j.SAPISID || j['__Secure-3PAPISID'] || j['__Secure-1PAPISID'])) throw new Error('No SAPISID cookie found. Copy the cookies of youtube.com while signed in.');
    const old = jar; jar = j;
    try { profile = await whoami(); } catch (e) { jar = old; throw e; }
    fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, txt.trim() + '\n', { mode: 0o600 });
    return profile;
  },
  async status() { if (!jar || !sapisid()) return { set: false }; if (!profile) { try { profile = await whoami(); } catch (e) { return { set: true, ok: false, error: e.message }; } } return { set: true, ok: true, name: profile }; },
  clear() { jar = null; profile = null; try { fs.unlinkSync(FILE); } catch (e) {} },
  post, walk,
};
