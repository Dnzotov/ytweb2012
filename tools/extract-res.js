#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Extracts the UI resources (layouts, drawables, strings...) from an original YouTube APK that YOU provide.
// The resources belong to Google and are not part of this repository.
//
//   node tools/extract-res.js <youtube-2.2.14.apk> v22
//   node tools/extract-res.js <youtube-3.3.0.apk>  v33
//
// Needs jadx (https://github.com/skylot/jadx) in PATH, or set JADX=/path/to/jadx.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const [apk, ver] = process.argv.slice(2);
if (!apk || !/^v(22|33)$/.test(ver || '')) {
  console.error('usage: node tools/extract-res.js <apk> v22|v33');
  process.exit(1);
}
if (!fs.existsSync(apk)) { console.error('APK not found: ' + apk); process.exit(1); }

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ytweb-'));
try {
  console.log('decoding resources with jadx…');
  // --no-src: resources only. jadx exits non-zero on some decompile warnings, so check the result instead.
  try { execFileSync(process.env.JADX || 'jadx', ['-q', '--no-src', '-d', out, apk], { stdio: 'inherit' }); } catch (e) {}
  const res = path.join(out, 'resources', 'res');
  if (!fs.existsSync(res)) throw new Error('jadx did not produce resources/res; is jadx installed?');

  const dest = path.join(__dirname, '..', 'public', 'apps', ver, 'res');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(res, dest, { recursive: true });
  // drop translations (values-xx, values-xx-rYY); the port uses the default English strings
  for (const d of fs.readdirSync(dest)) if (/^values-[a-z]{2}(-r[A-Z]{2})?$/.test(d)) fs.rmSync(path.join(dest, d), { recursive: true });
  console.log('resources written to ' + path.relative(process.cwd(), dest));
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
