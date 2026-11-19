// SPDX-License-Identifier: GPL-3.0-or-later
// Google sign-in through the OAuth "device code" flow (same flow smart TVs use): the user types a short code at google.com/device.
// Tokens are kept on THIS server in data/auth.json (mode 600). Anyone who can reach the server can use the signed-in account,
// so set YT_PIN when you expose the server on a network.
const https = require('https'), fs = require('fs'), path = require('path'), qs = require('querystring');
const CID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';   // public YouTube-on-TV client
const SECRET = 'SboVhoG9s0rNafixCSGGKXAT';
const FILE = path.join(__dirname, 'data', 'auth.json');
let pending = null, state = null;
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}

function form(url, body) {
  const data = qs.stringify(body), u = new URL(url);
  return new Promise((ok, no) => {
    const r = https.request({ host: u.host, path: u.pathname, method: 'POST', timeout: 15000, headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } }, res => {
      const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString())); } catch (e) { no(e); } });
    });
    r.on('error', no); r.on('timeout', () => r.destroy(new Error('timeout'))); r.end(data);
  });
}
function save() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state), { mode: 0o600 }); }

module.exports = {
  signedIn: () => !!(state && state.refresh_token),
  profile: () => state && state.profile || null,
  setProfile(p) { if (state) { state.profile = p; save(); } },
  async start() {
    const r = await form('https://oauth2.googleapis.com/device/code', { client_id: CID, scope: 'https://www.googleapis.com/auth/youtube' });
    if (!r.device_code) throw new Error(r.error_description || 'device code request failed');
    pending = { device_code: r.device_code, exp: Date.now() + r.expires_in * 1000 };
    return { user_code: r.user_code, url: r.verification_url, interval: r.interval, expires_in: r.expires_in };
  },
  async poll() {
    if (!pending || pending.exp < Date.now()) return { status: 'expired' };
    const r = await form('https://oauth2.googleapis.com/token', { client_id: CID, client_secret: SECRET, device_code: pending.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (r.error === 'authorization_pending' || r.error === 'slow_down') return { status: 'pending' };
    if (r.error) { pending = null; return { status: 'error', error: r.error }; }
    state = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in - 60) * 1000 }; pending = null; save();
    return { status: 'ok' };
  },
  async token() {
    if (!state || !state.refresh_token) return null;
    if (state.expires_at < Date.now()) {
      const r = await form('https://oauth2.googleapis.com/token', { client_id: CID, client_secret: SECRET, refresh_token: state.refresh_token, grant_type: 'refresh_token' });
      if (!r.access_token) { state = null; try { fs.unlinkSync(FILE); } catch (e) {} return null; }
      state.access_token = r.access_token; state.expires_at = Date.now() + (r.expires_in - 60) * 1000; save();
    }
    return state.access_token;
  },
  async logout() {
    const t = state && state.refresh_token; state = null; pending = null; try { fs.unlinkSync(FILE); } catch (e) {}
    if (t) form('https://oauth2.googleapis.com/revoke', { token: t }).catch(() => {});
  },
};
