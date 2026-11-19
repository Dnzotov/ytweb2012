// SPDX-License-Identifier: GPL-3.0-or-later
// View inflater + LinearLayout/FrameLayout (via CSS) + RelativeLayout (JS solver).
(function () {
  const RT = window.AndroidRT, { dim, ref, A } = RT;
  const FONT_LINE = 1.172; // Roboto ascent+descent
  const TEXT = new Set(['TextView', 'Button', 'EditText', 'CheckBox', 'RadioButton', 'CheckedTextView', 'AutoCompleteTextView']);

  async function inflate(name, parent, opts = {}) {
    const doc = await RT.xml('layout/' + name + '.xml');
    const el = await build(doc.documentElement, parent, opts);
    return el;
  }

  async function build(n, parent, opts) {
    let tag = n.tagName;
    if (tag === 'include') {
      const doc = await RT.xml('layout/' + n.getAttribute('layout').replace('@layout/', '') + '.xml');
      const r = doc.documentElement;
      const el = await build(r, parent, opts);
      for (const k of ['id']) { const v = A(n, k); if (v) setId(el, v); }
      for (const k of ['layout_width', 'layout_height']) if (A(n, k)) el.__lp[k] = A(n, k);
      applyLayoutParams(el, parent);
      return el;
    }
    if (tag === 'merge') { const f = document.createDocumentFragment(); for (const c of n.children) f.appendChild(await build(c, opts.parentView || null, opts)); return f; }
    const short = tag.split('.').pop();
    const el = document.createElement('div');
    el.className = 'v ' + short;
    el.__n = n; el.__tag = short;
    const style = n.getAttribute('style');
    const si = style ? RT.styleItems(style) : {};
    const at = k => A(n, k) ?? si[k] ?? null;
    el.__at = at;
    el.__lp = {}; for (const a of n.attributes) if (a.localName.startsWith('layout_')) el.__lp[a.localName] = a.value;
    el.__state = { enabled: true };
    if (A(n, 'id')) setId(el, A(n, 'id'));
    if (A(n, 'tag')) el.dataset.tag = RT.ref(A(n, 'tag'));

    const isLinear = short === 'LinearLayout';
    const isRel = short === 'RelativeLayout';
    const isFrame = /FrameLayout|ScrollView/.test(short) || (!isLinear && !isRel && !TEXT.has(short) && short !== 'ImageView' && short !== 'View');
    const list = /ListView|GridView|PagedListView|Workspace/.test(short);
    el.__scroll = short === 'ScrollView';
    el.__kind = isLinear ? 'linear' : isRel ? 'relative' : list ? 'list' : isFrame ? 'frame' : 'leaf';
    const s = el.style;
    s.boxSizing = 'border-box'; s.position = 'relative';
    if (isLinear) {
      const vert = at('orientation') === 'vertical';
      el.__vert = vert; s.display = 'flex'; s.flexDirection = vert ? 'column' : 'row';
      applyGravity(el, at('gravity'), vert);
    } else if (el.__scroll) { s.display = 'block'; s.overflowY = 'auto'; }
    else if (isFrame || list) { s.display = 'grid'; s.gridTemplate = '1fr / 1fr'; s.alignItems = 'start'; s.justifyItems = 'start'; if (list) { s.overflowY = 'auto'; s.display = 'block'; } }
    else if (isRel) { s.display = 'block'; }

    // padding / min sizes
    const p = at('padding'), pl = at('paddingLeft') ?? p, pt = at('paddingTop') ?? p, pr = at('paddingRight') ?? p, pb = at('paddingBottom') ?? p;
    el.__pad = [dim(pl), dim(pt), dim(pr), dim(pb)];
    const hasPad = [pl, pt, pr, pb].some(x => x != null);
    if (at('minWidth')) s.minWidth = dim(at('minWidth')) + 'px';
    if (at('minHeight')) s.minHeight = dim(at('minHeight')) + 'px';
    if (at('visibility') === 'gone') el.__gone = true;
    if (at('visibility') === 'invisible') s.visibility = 'hidden';
    if (at('alpha')) s.opacity = at('alpha');

    // background
    const bg = at('background');
    el.__bgHost = document.createElement('div'); el.__bgHost.className = 'bg'; Object.assign(el.__bgHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '-1' });
    el.prepend(el.__bgHost); s.isolation = 'isolate';
    if (bg) {
      el.__bg = await RT.drawable(bg) || (RT.parseColor(bg) ? { kind: 'color', css: { backgroundColor: RT.parseColor(bg) } } : null);
      if (el.__bg && !hasPad) { const bp = RT.bgPadding(el.__bg); if (bp) el.__pad = [bp.l, bp.t, bp.r, bp.b]; }
    }
    s.padding = `${el.__pad[1]}px ${el.__pad[2]}px ${el.__pad[3]}px ${el.__pad[0]}px`;
    if (el.__bg && short !== 'ImageView' && short !== 'ImageButton') {   // View.getSuggestedMinimum*: background's intrinsic size
      const i = RT.intrinsic(el.__bg);
      if (i) { if (!at('minWidth')) s.minWidth = i.w + 'px'; if (!at('minHeight')) s.minHeight = i.h + 'px'; }
    }

    if (TEXT.has(short)) await buildText(el, at);
    if (short === 'ImageView' || short === 'ImageButton') await buildImage(el, at);
    if (short === 'ProgressBar') { el.classList.add('spinner'); }
    if (A(n, 'clickable') === 'true' || el.__bg && RT.pick(el.__bg, { pressed: true }) !== RT.pick(el.__bg, {}) || short === 'Button' || short === 'ImageButton') makeInteractive(el);
    refreshBg(el);

    // children
    if (!opts.noChildren) for (const c of n.children) { const ch = await build(c, el, opts); appendChild(el, ch); }
    applyLayoutParams(el, parent);
    return el;
  }

  function setId(el, v) { const id = v.replace(/^@\+?id\//, ''); el.id = 'id_' + id; el.dataset.id = id; }
  function applyGravity(el, g, vert) {
    if (!g) return; const set = new Set(g.split('|'));
    const h = set.has('center_horizontal') || set.has('center') ? 'center' : set.has('right') || set.has('end') ? 'flex-end' : null;
    const v = set.has('center_vertical') || set.has('center') ? 'center' : set.has('bottom') ? 'flex-end' : null;
    const [main, cross] = vert ? [v, h] : [h, v];
    if (main) el.style.justifyContent = main; if (cross) el.style.alignItems = cross;
  }

  async function buildText(el, at) {
    const span = document.createElement('span'); span.className = 't'; el.appendChild(span); el.__text = span;
    const size = dim(at('textSize'), 14);
    Object.assign(span.style, { display: 'block', fontSize: size + 'px', lineHeight: FONT_LINE, minWidth: '0' });
    el.style.fontSize = size + 'px';
    const ts = at('textStyle') || ''; if (ts.includes('bold')) span.style.fontWeight = 700; if (ts.includes('italic')) span.style.fontStyle = 'italic';
    const cs = at('textColor') ? await RT.colorState(at('textColor')) : null;
    el.__color = cs; applyColor(el);
    let txt = at('text'); if (txt) span.textContent = RT.ref(txt);
    const ta = at('textAppearance'); if (!at('textSize') && ta) { const z = /Large/.test(ta) ? 22 : /Medium/.test(ta) ? 18 : /Small/.test(ta) ? 14 : null; if (z) { span.style.fontSize = z + 'px'; el.style.fontSize = z + 'px'; } }
    const g = at('gravity') || 'left|top', set = new Set(g.split('|'));
    el.style.display = 'flex';
    span.style.textAlign = set.has('center') || set.has('center_horizontal') ? 'center' : set.has('right') ? 'right' : 'left';
    el.style.alignItems = set.has('center') || set.has('center_vertical') ? 'center' : set.has('bottom') ? 'flex-end' : 'flex-start';
    if (set.has('center') || set.has('center_horizontal')) el.style.justifyContent = 'center';
    const lines = at('maxLines') || at('lines') || (at('singleLine') === 'true' ? 1 : null);
    if (lines) clamp(span, +lines);
    if (at('ellipsize') && !lines) clamp(span, 1);
    if (at('includeFontPadding') === 'false') span.style.lineHeight = 1.1;
    if (el.__tag === 'Button') { el.classList.add('btn'); }
    if (cs === null) el.style.color = window.TEXT_DEFAULT || '#000';
  }
  function clamp(span, n) {
    if (n === 1) Object.assign(span.style, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    else Object.assign(span.style, { display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden' });
  }
  function applyColor(el) { if (el.__color) el.style.color = RT.pickColor(el.__color, el.__state) || '#000'; }

  async function buildImage(el, at) {
    const d = at('src') ? await RT.drawable(at('src')) : null;
    el.__src = d;
    const img = document.createElement('div'); img.className = 'img'; el.appendChild(img); el.__img = img;
    const i = d && RT.intrinsic(d);
    el.__intrinsic = i;
    Object.assign(img.style, { position: 'absolute', inset: '0', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' });
    paintImage(el);
    const st = at('scaleType');
    img.style.backgroundSize = st === 'center' ? 'auto' : st === 'centerCrop' ? 'cover' : st === 'fitXY' ? '100% 100%' : (st === 'centerInside' || !st || st === 'fitCenter') ? 'contain' : 'auto';
    if (i && (!st || st === 'fitCenter')) img.style.backgroundSize = (i.w >= 0 ? i.w + 'px ' + i.h + 'px' : 'contain');
  }
  function paintImage(el) {
    const d = RT.pick(el.__src, el.__state); if (!d || !el.__img) return;
    if (d.kind === 'bitmap') el.__img.style.backgroundImage = `url(${d.url})`;
    else if (d.kind === 'nine') el.__img.style.backgroundImage = `url(${d.n.url})`;
    else RT.paint(el.__img, el.__src, el.__state);
  }

  function refreshBg(el) { if (el.__bg) RT.paint(el.__bgHost, el.__bg, el.__state); }
  function setState(el, k, v) { if (!!el.__state[k] === v) return; el.__state[k] = v; refreshBg(el); applyColor(el); if (el.__src) paintImage(el); }
  function makeInteractive(el) {
    el.style.cursor = 'pointer'; el.style.userSelect = 'none'; el.style.webkitTapHighlightColor = 'transparent';
    const on = () => setState(el, 'pressed', true), off = () => setState(el, 'pressed', false);
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
  }

  function appendChild(parent, ch) {
    if (ch.nodeType === 11) { parent.appendChild(ch); return; }
    parent.appendChild(ch);
  }

  // ---- layout params ----
  function applyLayoutParams(el, parent) {
    const lp = el.__lp, s = el.style; const pk = parent && parent.__kind;
    const mAll = lp.layout_margin; const m = k => dim(lp['layout_margin' + k] ?? mAll);
    el.__m = { l: m('Left'), t: m('Top'), r: m('Right'), b: m('Bottom') };
    el.__parentKind = pk;
    const W = lp.layout_width, H = lp.layout_height;
    const fixed = v => v && v !== 'match_parent' && v !== 'fill_parent' && v !== 'wrap_content';
    const mp = v => v === 'match_parent' || v === 'fill_parent';
    const vert = parent && parent.__vert; 
    s.margin = `${el.__m.t}px ${el.__m.r}px ${el.__m.b}px ${el.__m.l}px`;
    if (el.__gone) { s.display = 'none'; el.__gone = false; el.__hidden = true; }
    if (el.__intrinsic) { const [pl_, pt_, pr_, pb_] = el.__pad; if (W === 'wrap_content') s.width = el.__intrinsic.w + pl_ + pr_ + 'px'; if (H === 'wrap_content') s.height = el.__intrinsic.h + pt_ + pb_ + 'px'; }
    if (parent && parent.__scroll) { s.width = '100%'; if (mp(H)) { s.height = 'auto'; s.minHeight = '100%'; } return; }
    if (pk === 'relative') { s.position = 'absolute'; s.margin = '0'; return; }
    if (fixed(W)) s.width = dim(W) + 'px'; if (fixed(H)) s.height = dim(H) + 'px';
    if (pk === 'linear') {
      const w = parseFloat(lp.layout_weight || 0);
      const main = vert ? 'height' : 'width', mainV = vert ? H : W, crossV = vert ? W : H;
      s.minWidth = s.minWidth || '0'; 
      if (el.__kind === 'linear' || el.__kind === 'frame') { if (mp(mainV) || w > 0) s.minHeight = s.minHeight || '0'; }
      if (w > 0) { s.flex = `${w} 1 0`; s[main] = ''; if (vert) s.minHeight = s.minHeight || '0'; }
      else if (mp(mainV)) s.flex = '1 1 auto';
      else s.flex = '0 0 auto';
      if (mp(crossV)) s.alignSelf = 'stretch';
      const g = lp.layout_gravity;
      if (g) { const set = new Set(g.split('|')); const cc = set.has('center') ;
        if (vert) s.alignSelf = set.has('center_horizontal') || cc ? 'center' : set.has('right') ? 'flex-end' : s.alignSelf;
        else s.alignSelf = set.has('center_vertical') || cc ? 'center' : set.has('bottom') ? 'flex-end' : s.alignSelf; }
      if (!vert && mp(W) && !(w > 0)) s.minWidth = '0';
    } else {
      // frame / list / root
      if (mp(W)) s.width = `calc(100% - ${el.__m.l + el.__m.r}px)`; if (mp(H)) s.height = `calc(100% - ${el.__m.t + el.__m.b}px)`;
      const g = lp.layout_gravity;
      if (g) { const set = new Set(g.split('|')); if (set.has('center') || set.has('center_horizontal')) s.justifySelf = 'center'; if (set.has('center') || set.has('center_vertical')) s.alignSelf = 'center'; if (set.has('right')) s.justifySelf = 'end'; if (set.has('bottom')) s.alignSelf = 'end'; }
    }
    if (el.__kind === 'list' && pk === 'linear') { s.minHeight = '0'; }
    if (el.__kind === 'list' && pk !== 'linear') { s.width = s.width || '100%'; s.height = s.height || '100%'; }
  }

  // ---- RelativeLayout solver ----
  function layoutRelative(rel) {
    const kids = [...rel.children].filter(c => c.__lp && c.__n && !c.__hidden && c.style.display !== 'none');
    const ids = {}; kids.forEach(k => { if (k.dataset.id) ids[k.dataset.id] = k; });
    const [pl, pt, pr, pb] = rel.__pad;
    const wMode = rel.__lp.layout_width, hMode = rel.__lp.layout_height;
    const W = rel.clientWidth || rel.getBoundingClientRect().width;
    let H = rel.clientHeight;
    let box = new Map(); let todo = new Set(kids);
    const idOf = v => v && v.replace(/^@\+?id\//, '');
    const anchorIds = k => ['toRightOf', 'toLeftOf', 'below', 'above', 'alignLeft', 'alignRight', 'alignTop', 'alignBottom'].map(r => idOf(k.__lp['layout_' + r])).filter(Boolean);
    const innerW = W - pl - pr;
    const wrapH = !/match_parent|fill_parent/.test(hMode || '') && !(hMode && /^-?[\d.]+(dp|px|dip)$/.test(hMode));
    function run() {
      box = new Map(); todo = new Set(kids); let guard = 0;
      while (todo.size && guard++ < 50) {
        let progressed = false;
        for (const k of [...todo]) {
          if (!anchorIds(k).every(i => !ids[i] || box.has(ids[i]) || ids[i] === k)) continue;
          place(k); todo.delete(k); progressed = true;
        }
        if (!progressed) { const k = [...todo][0]; place(k); todo.delete(k); }
      }
    }
    if (wrapH) {
      H = 0; run(); let bottom = 0; for (const [, bx] of box) bottom = Math.max(bottom, bx.b + bx.m.b);
      H = bottom + pb; rel.style.height = H + 'px';
    }
    run();
    function place(k) {
      const lp = k.__lp, m = k.__m, s = k.style;
      const A_ = key => { const i = idOf(lp['layout_' + key]); return i && ids[i] && box.get(ids[i]); };
      const T = key => lp['layout_' + key] === 'true';
      const fixedW = v => v && !/match_parent|fill_parent|wrap_content/.test(v);
      let l = null, r = null, t = null, b = null;
      let a;
      if (a = A_('toRightOf')) l = a.r + a.m.r + m.l; else if (a = A_('alignLeft')) l = a.l + m.l; else if (T('alignParentLeft')) l = pl + m.l;
      if (a = A_('toLeftOf')) r = a.l - a.m.l - m.r; else if (a = A_('alignRight')) r = a.r - m.r; else if (T('alignParentRight')) r = W - pr - m.r;
      if (a = A_('below')) t = a.b + a.m.b + m.t; else if (a = A_('alignTop')) t = a.t + m.t; else if (T('alignParentTop')) t = pt + m.t;
      if (a = A_('above')) b = a.t - a.m.t - m.b; else if (a = A_('alignBottom')) b = a.b - m.b; else if (T('alignParentBottom') && H) b = H - pb - m.b;
      if (l == null && r == null && !T('centerInParent') && !T('centerHorizontal')) l = pl + m.l;
      if (t == null && b == null && !T('centerInParent') && !T('centerVertical')) t = pt + m.t;
      const mpW = /match_parent|fill_parent/.test(lp.layout_width || ''), mpH = /match_parent|fill_parent/.test(lp.layout_height || '');
      s.left = '0px'; s.top = '0px';
      // width
      if (fixedW(lp.layout_width)) { s.width = dim(lp.layout_width) + 'px'; }
      else if (mpW) { const lw = l ?? (pl + m.l), rw = r ?? (W - pr - m.r); s.width = Math.max(0, rw - lw) + 'px'; }
      else if (l != null && r != null) s.width = Math.max(0, r - l) + 'px';
      else if (k.__intrinsic) { s.width = k.__intrinsic.w + k.__pad[0] + k.__pad[2] + 'px'; }
      else { s.width = ''; const avail = r != null ? r - pl - m.l : (l != null ? W - pr - l - m.r : innerW - m.l - m.r); s.maxWidth = Math.max(0, avail) + 'px'; }
      let w = k.getBoundingClientRect().width;
      if (l != null && r == null) r = l + w; else if (r != null && l == null) l = r - w; else if (l == null) l = pl + (innerW - w) / 2;
      // height
      if (!/match_parent|fill_parent|wrap_content/.test(lp.layout_height || '') && lp.layout_height) s.height = dim(lp.layout_height) + 'px';
      else if (mpH && H) { const tt = t ?? (pt + m.t), bb = b ?? (H - pb - m.b); s.height = Math.max(0, bb - tt) + 'px'; }
      else if (t != null && b != null) s.height = Math.max(0, b - t) + 'px';
      else if (k.__intrinsic && (lp.layout_height === 'wrap_content')) s.height = k.__intrinsic.h + k.__pad[1] + k.__pad[3] + 'px';
      else if (k.__kind === 'relative' && k.style.height) { /* keep height computed by its own solver */ }
      else s.height = '';
      let h = k.getBoundingClientRect().height;
      if (t != null && b == null) b = t + h; else if (b != null && t == null) t = b - h; else if (t == null) t = pt + ((H || h) - pt - pb - h) / 2;
      s.left = l + 'px'; s.top = t + 'px';
      box.set(k, { l, r: l + w, t, b: t + h, m });
    }
    if (wMode === 'wrap_content') { let right = 0; for (const [, bx] of box) right = Math.max(right, bx.r + bx.m.r); rel.style.width = right + pr + 'px'; }
  }
  function layoutTree(root) {
    const rels = []; const walk = e => { if (e.__kind === 'relative') rels.push(e); for (const c of e.children) if (c.__kind || c.children.length) walk(c); };
    walk(root);
    for (let pass = 0; pass < 2; pass++) { for (const r of [...rels].reverse()) layoutRelative(r); for (const r of rels) layoutRelative(r); }
  }
  let pending = false;
  function requestLayout(root) { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; layoutTree(root); }); }

  const find = (root, id) => root.querySelector('[data-id="' + id + '"]');
  const findTag = (root, tag) => root.querySelector('[data-tag="' + tag + '"]');
  function setVisible(el, v) { if (!el) return; el.style.display = v ? (el.__kind === 'linear' ? 'flex' : el.__tag && TEXT.has(el.__tag) ? 'flex' : el.__kind === 'relative' ? 'block' : el.__kind === 'frame' ? 'grid' : '') : 'none'; el.__hidden = !v; }

  window.Views = { inflate, build, layoutTree, requestLayout, find, findTag, setVisible, setState, refreshBg };
})();
