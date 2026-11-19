// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal Android View/Resources runtime for the browser.
// It reads the ORIGINAL res/ XML (layouts, drawables, values) from the APK unchanged.
// 1dp == 1 CSS px. Bitmap assets use the hdpi bucket (1.5x) and are shown at px/1.5.
(function () {
  const DENSITY = 1.5;
  const RES = window.RES_BASE || 'res';
  const BUCKETS = ['drawable-hdpi-v4', 'drawable-xhdpi-v4', 'drawable-mdpi-v4', 'drawable-nodpi-v4', 'drawable'];
  const NS = 'http://schemas.android.com/apk/res/android';
  const R = { dimen: {}, color: {}, string: {}, style: {}, integer: {}, bool: {}, drawableAlias: {}, index: null };
  const cache = { xml: {}, img: {}, nine: {}, drawable: {} };

  const fetchText = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); };
  async function xml(path) {
    if (!cache.xml[path]) cache.xml[path] = fetchText(RES + '/' + path).then(t => new DOMParser().parseFromString(t, 'text/xml'));
    return cache.xml[path];
  }
  const A = (n, name) => n.getAttributeNS(NS, name) ?? n.getAttribute('android:' + name);

  async function loadValues() {
    R.index = await (await fetch(RES + '-index.json')).json();
    for (const f of ['dimens', 'colors', 'strings', 'styles', 'integers', 'bools', 'drawables']) {
      for (const dir of ['values', 'values-hdpi-v4', 'values-port']) {
        if (!R.index[dir] || !R.index[dir].includes(f + '.xml')) continue;
        const d = await xml(dir + '/' + f + '.xml');
        for (const e of d.documentElement.children) {
          const name = e.getAttribute('name'), tag = e.tagName;
          if (tag === 'dimen') R.dimen[name] = e.textContent.trim();
          else if (tag === 'color') R.color[name] = e.textContent.trim();
          else if (tag === 'string') R.string[name] = e.textContent.trim().replace(/^"|"$/g, '').replace(/\\'/g, "'").replace(/\\n/g, '\n');
          else if (tag === 'integer') R.integer[name] = e.textContent.trim();
          else if (tag === 'bool') R.bool[name] = e.textContent.trim();
          else if (tag === 'item' && e.getAttribute('type') === 'drawable') R.drawableAlias[name] = e.textContent.trim();
          else if (tag === 'style') {
            const items = {};
            for (const i of e.children) items[i.getAttribute('name').replace(/^android:/, '')] = i.textContent.trim();
            R.style[name] = { parent: (e.getAttribute('parent') || '').replace(/^@?style\//, ''), items };
          }
        }
      }
    }
  }

  // ---- value resolution ----
  function ref(v, depth = 0) {
    if (typeof v !== 'string' || depth > 8) return v;
    const ma = /^\?(?:android:)?attr\/(\w+)$/.exec(v);
    if (ma) return ({ listPreferredItemHeight: '64dp', textAppearanceMedium: 'Medium', textAppearanceLarge: 'Large', textAppearanceSmall: 'Small' })[ma[1]] ?? v;
    const m = /^@(?:\+)?(\w+):?\/?(dimen|color|string|integer|bool|style|drawable|id)?\/?(.*)$/.exec(v);
    const m2 = /^@(dimen|color|string|integer|bool|drawable|id|style)\/(.+)$/.exec(v);
    if (!m2) return v;
    const [, t, n] = m2;
    const table = R[t];
    if (table && table[n] !== undefined) return ref(table[n], depth + 1);
    return v;
  }
  function dim(v, dflt = 0) {
    v = ref(v);
    if (v == null) return dflt;
    const m = /^(-?[\d.]+)(dp|dip|sp|px|pt|mm|in)?$/.exec(String(v).trim());
    if (!m) return dflt;
    const n = parseFloat(m[1]);
    return m[2] === 'px' ? n / DENSITY : n;
  }
  function parseColor(v) {
    v = ref(v);
    if (typeof v !== 'string' || v[0] !== '#') return null;
    let h = v.slice(1);
    if (h.length === 3) h = 'f' + h; // #rgb
    if (h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length === 6) h = 'ff' + h;
    if (h.length === 3 * 2 + 2 === 0) return null;
    const a = parseInt(h.slice(0, 2), 16) / 255, r = parseInt(h.slice(2, 4), 16), g = parseInt(h.slice(4, 6), 16), b = parseInt(h.slice(6, 8), 16);
    return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
  }

  // ---- images / 9-patch ----
  function loadImg(url) {
    if (!cache.img[url]) cache.img[url] = new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(url)); i.src = url; });
    return cache.img[url];
  }
  function findFile(name, exts) {
    for (const b of BUCKETS) {
      const list = R.index[b]; if (!list) continue;
      for (const e of exts) if (list.includes(name + e)) return { dir: b, file: name + e, ext: e };
    }
    return null;
  }
  const scaleOf = u => /xhdpi/.test(u) ? 2 : /hdpi/.test(u) ? 1.5 : /nodpi/.test(u) ? 1 : 1;
  async function nine(url) {
    if (cache.nine[url]) return cache.nine[url];
    const sc = scaleOf(url);
    return cache.nine[url] = (async () => {
      // aapt-compiled 9-patch: no border pixels, geometry is stored in the npTc chunk.
      const buf = new DataView(await (await fetch(url)).arrayBuffer());
      let p = 8, np = null, w = 0, h = 0;
      while (p < buf.byteLength) {
        const len = buf.getUint32(p), type = String.fromCharCode(buf.getUint8(p + 4), buf.getUint8(p + 5), buf.getUint8(p + 6), buf.getUint8(p + 7));
        if (type === 'IHDR') { w = buf.getUint32(p + 8); h = buf.getUint32(p + 12); }
        if (type === 'npTc') np = p + 8;
        p += 12 + len;
      }
      const img = await loadImg(url);
      if (np == null) return { url, cw: w, ch: h, sc, slice: [0, 0, 0, 0], pad: { l: 0, t: 0, r: 0, b: 0 }, plain: true };
      const nx = buf.getUint8(np + 1), ny = buf.getUint8(np + 2);
      const pad = [12, 16, 20, 24].map(o => buf.getInt32(np + o));
      const xs = [], ys = [];
      for (let i = 0; i < nx; i++) xs.push(buf.getInt32(np + 32 + i * 4));
      for (let i = 0; i < ny; i++) ys.push(buf.getInt32(np + 32 + nx * 4 + i * 4));
      const x0 = nx ? xs[0] : 0, x1 = nx ? xs[nx - 1] : w, y0 = ny ? ys[0] : 0, y1 = ny ? ys[ny - 1] : h;
      return { url, cw: w, ch: h, sc, slice: [y0, w - x1, h - y1, x0], pad: { l: pad[0] / sc, r: pad[1] / sc, t: pad[2] / sc, b: pad[3] / sc } };
    })();
  }

  // ---- drawables: object { w,h,pad, items:[{states, css|fn}] } ----
  async function drawable(refStr) {
    if (!refStr) return null;
    let v = ref(refStr);
    if (typeof v === 'string' && v[0] === '#') return { kind: 'color', css: { backgroundColor: parseColor(v) } };
    const m = /^@drawable\/(.+)$/.exec(v); if (!m) return null;
    const name = m[1];
    if (cache.drawable[name]) return cache.drawable[name];
    return cache.drawable[name] = (async () => {
      const xf = R.index.drawable && R.index.drawable.includes(name + '.xml');
      if (xf) return parseDrawableXml((await xml('drawable/' + name + '.xml')).documentElement);
      const f9 = findFile(name, ['.9.png']);
      if (f9) { const n = await nine(RES + '/' + f9.dir + '/' + f9.file); return { kind: 'nine', n }; }
      const f = findFile(name, ['.png']);
      if (f) { const img = await loadImg(RES + '/' + f.dir + '/' + f.file); const scale = scaleOf(f.dir); return { kind: 'bitmap', url: img.src, w: img.width / scale, h: img.height / scale }; }
      return null;
    })();
  }
  async function parseDrawableXml(n) {
    const t = n.tagName;
    if (t === 'selector') {
      const items = [];
      for (const i of n.children) {
        const st = {};
        for (const a of ['pressed', 'selected', 'focused', 'enabled', 'checked', 'activated']) { const x = A(i, 'state_' + a); if (x != null) st[a] = x === 'true'; }
        const d = A(i, 'drawable') ? await drawable(A(i, 'drawable')) : (i.firstElementChild ? await parseDrawableXml(i.firstElementChild) : null);
        items.push({ st, d });
      }
      return { kind: 'selector', items };
    }
    if (t === 'bitmap') {
      const d = await drawable(A(n, 'src')); if (!d) return null;
      return { ...d, tile: A(n, 'tileMode') === 'repeat' };
    }
    if (t === 'shape') {
      const css = {}; const shape = A(n, 'shape') || 'rectangle';
      const sd = n.querySelector('solid'), st = n.querySelector('stroke'), co = n.querySelector('corners'), gr = n.querySelector('gradient');
      if (sd) css.backgroundColor = parseColor(A(sd, 'color'));
      if (gr) css.backgroundImage = `linear-gradient(${A(gr, 'angle') == 270 ? 'to bottom' : 'to top'},${parseColor(A(gr, 'startColor'))},${parseColor(A(gr, 'endColor'))})`;
      if (st) css.border = `${dim(A(st, 'width'))}px solid ${parseColor(A(st, 'color'))}`;
      if (co) css.borderRadius = dim(A(co, 'radius')) + 'px';
      if (shape === 'oval') css.borderRadius = '50%';
      return { kind: 'shape', css };
    }
    if (t === 'layer-list') {
      const layers = [];
      for (const i of n.children) {
        const d = A(i, 'drawable') ? await drawable(A(i, 'drawable')) : (i.firstElementChild ? await parseDrawableXml(i.firstElementChild) : null);
        layers.push({ d, ins: ['left', 'top', 'right', 'bottom'].map(k => dim(A(i, k))) });
      }
      return { kind: 'layers', layers };
    }
    if (t === 'inset' || t === 'rotate' || t === 'clip' || t === 'scale') { const c = n.firstElementChild ? await parseDrawableXml(n.firstElementChild) : (A(n, 'drawable') ? await drawable(A(n, 'drawable')) : null); return c; }
    if (t === 'level-list' || t === 'transition') { const i = n.lastElementChild; return i ? (A(i, 'drawable') ? drawable(A(i, 'drawable')) : parseDrawableXml(i.firstElementChild)) : null; }
    return null;
  }
  function pick(d, state) {
    while (d && d.kind === 'selector') {
      const it = d.items.find(i => Object.entries(i.st).every(([k, v]) => !!state[k] === v));
      d = it ? it.d : null;
    }
    return d;
  }
  function intrinsic(d) {
    d = pick(d, {}); if (!d) return null;
    if (d.kind === 'bitmap') return { w: d.w, h: d.h };
    if (d.kind === 'nine') return { w: d.n.cw / d.n.sc, h: d.n.ch / d.n.sc };
    if (d.kind === 'layers') { for (const l of d.layers) { const i = intrinsic(l.d); if (i) return i; } }
    return null;
  }
  // Paint drawable into container element `host` (a div filling the view).
  function paint(host, d, state) {
    host.replaceChildren(); host.removeAttribute('style');
    Object.assign(host.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '-1' });
    d = pick(d, state); if (!d) return;
    if (d.kind === 'color' || d.kind === 'shape') Object.assign(host.style, d.css);
    else if (d.kind === 'bitmap') {
      host.style.backgroundImage = `url(${d.url})`;
      if (d.tile) { host.style.backgroundRepeat = 'repeat'; host.style.backgroundSize = d.w + 'px ' + d.h + 'px'; }
      else { host.style.backgroundRepeat = 'no-repeat'; host.style.backgroundSize = '100% 100%'; }
    } else if (d.kind === 'nine') {
      const s = d.n.slice;
      Object.assign(host.style, {
        boxSizing: 'border-box', borderStyle: 'solid', borderColor: 'transparent',
        borderWidth: s.map(x => x / d.n.sc + 'px').join(' '),
        borderImage: `url(${d.n.url}) ${s.join(' ')} fill / ${s.map(x => x / d.n.sc + 'px').join(' ')} stretch`
      });
    } else if (d.kind === 'layers') {
      for (const l of d.layers) { const c = document.createElement('div'); paint(c, l.d, state); c.style.inset = l.ins.map(x => x + 'px').join(' '); c.style.zIndex = '0'; host.appendChild(c); }
    }
  }
  function bgPadding(d) { d = pick(d, {}); return d && d.kind === 'nine' ? d.n.pad : null; }

  // ---- color state lists ----
  async function colorState(v) {
    v = ref(v);
    if (typeof v !== 'string') return null;
    if (v[0] === '#') return { fixed: parseColor(v) };
    const m = /^@color\/(.+)$/.exec(v); if (!m) return null;
    if (R.index.color && R.index.color.includes(m[1] + '.xml')) {
      const d = await xml('color/' + m[1] + '.xml'); const items = [];
      for (const i of d.documentElement.children) {
        const st = {}; for (const a of ['pressed', 'selected', 'focused', 'enabled']) { const x = A(i, 'state_' + a); if (x != null) st[a] = x === 'true'; }
        items.push({ st, c: parseColor(A(i, 'color')) });
      }
      return { items };
    }
    return null;
  }
  const pickColor = (cs, state) => cs.fixed || (cs.items.find(i => Object.entries(i.st).every(([k, v]) => !!state[k] === v)) || {}).c;

  // ---- style attribute lookup ----
  function styleItems(styleRef) {
    const out = {}; const chain = [];
    let n = ref(styleRef) === styleRef ? (String(styleRef).replace(/^@style\//, '')) : styleRef;
    while (n && R.style[n]) { chain.unshift(R.style[n]); n = R.style[n].parent || (n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : ''); }
    for (const s of chain) Object.assign(out, s.items);
    return out;
  }

  window.AndroidRT = { R, dim, ref, parseColor, xml, loadValues, drawable, paint, intrinsic, bgPadding, pick, colorState, pickColor, styleItems, DENSITY, A, NS };
})();
