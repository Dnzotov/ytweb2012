// SPDX-License-Identifier: GPL-3.0-or-later
// Activity layer. First milestone: HomeActivity (phone) built from the original res/ XML.
(async function () {
  const RT = window.AndroidRT, V = window.Views, screen = document.getElementById('screen');
  await RT.loadValues();
  const D = RT.DENSITY;

  const VIDEOS = [
    ['Big Buck Bunny', 'blender', '2,419,017 views', '9:56'],
    ['Android 4.0: Ice Cream Sandwich', 'Android', '1,200,455 views', '3:12'],
    ['Nexus S: Official Demo', 'Google', '884,031 views', '1:48'],
    ['Sintel (Blender Foundation)', 'blender', '3,552,910 views', '14:48'],
    ['The Making of Honeycomb', 'Android Developers', '421,877 views', '5:20'],
    ['Google Chrome: Speed Tests', 'GoogleChrome', '2,090,114 views', '2:03'],
  ];

  function el(tag, cls, css) { const e = document.createElement(tag); if (cls) e.className = cls; if (css) Object.assign(e.style, css); return e; }
  const color = n => RT.parseColor('@color/' + n);

  // ---- Holo action bar (framework chrome, approximated; the app's own drawables are used) ----
  async function actionBar(tabs, selected, onTab) {
    const bar = el('div', 'actionbar', { height: '48px', flex: '0 0 auto', position: 'relative', display: 'flex', alignItems: 'center', isolation: 'isolate' });
    const bg = el('div'); bar.appendChild(bg); RT.paint(bg, await RT.drawable('@drawable/bg_stripes_dark_drawable'), {});
    const logo = el('div', '', { width: '48px', height: '48px', margin: '0 0 0 0', background: 'url(apps/v33/res/drawable-hdpi-v4/ic_logo_wide.png) no-repeat left center', backgroundSize: '112px 48px' });
    logo.style.width = '90px'; logo.style.height = '48px'; logo.style.backgroundSize = '75px 32px'; logo.style.backgroundPosition = '8px center';
    bar.appendChild(logo);
    const sp = el('div', '', { flex: '1' }); bar.appendChild(sp);
    for (const ic of ['ic_menu_capture', 'ic_menu_search']) {
      const b = el('div', '', { width: '48px', height: '48px', background: `url(apps/v33/res/drawable-hdpi-v4/${ic}.png) no-repeat center`, backgroundSize: '32px 32px', cursor: 'pointer' });
      bar.appendChild(b);
    }
    const wrap = el('div', 'tabrow', { display: 'flex', flex: '0 0 auto', height: '48px', position: 'relative', isolation: 'isolate' });
    const bg2 = el('div'); wrap.appendChild(bg2); RT.paint(bg2, await RT.drawable('@drawable/bg_stripes_dark_drawable'), {});
    const tabEls = [];
    const tabD = await RT.drawable('@drawable/tab_drawable');
    const tcs = await RT.colorState('@color/primary_contrast_font');
    for (let i = 0; i < tabs.length; i++) {
      const t = el('div', 'tab', { flex: '1', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '20px', padding: '0 11px', isolation: 'isolate', cursor: 'pointer', userSelect: 'none', webkitTapHighlightColor: 'transparent' });
      const b = el('div'); t.appendChild(b); const s = { selected: i === selected, pressed: false };
      const txt = el('span', '', { lineHeight: 1.172, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); txt.textContent = tabs[i]; t.appendChild(txt);
      const repaint = () => RT.paint(b, tabD, s);
      repaint();
      t.addEventListener('pointerdown', () => { s.pressed = true; repaint(); });
      t.addEventListener('pointerup', () => { s.pressed = false; repaint(); });
      t.addEventListener('pointerleave', () => { s.pressed = false; repaint(); });
      t.addEventListener('click', () => onTab(i));
      t.__s = s; t.__repaint = repaint; tabEls.push(t); wrap.appendChild(t);
    }
    bar.__select = i => tabEls.forEach((t, k) => { t.__s.selected = k === i; t.__repaint(); });
    const holder = el('div', '', { flex: '0 0 auto' }); holder.appendChild(bar); holder.appendChild(wrap);
    holder.__select = bar.__select;
    return holder;
  }

  async function videoItem(v) {
    const it = await V.inflate('video_item', null);
    const set = (id, t) => { const e = V.find(it, id); e.querySelector('.t').textContent = t; };
    set('title', v[0]); set('author', v[1]); set('detail', v[2]); set('duration', v[3]);
    const th = V.find(it, 'thumbnail');
    th.__img.style.backgroundImage = 'none';
    th.style.background = 'linear-gradient(135deg,#556,#223)';
    return it;
  }

  async function home() {
    screen.replaceChildren();
    const content = el('div', '', { flex: '1', position: 'relative', overflow: 'hidden', background: color('primary_background') });
    const bg = el('div', '', { position: 'absolute', inset: '0' });
    const tabs = ['Home', 'Browse', 'Account'];
    const bar = await actionBar(tabs, 0, i => show(i));
    screen.appendChild(bar); screen.appendChild(content);
    const pages = [];
    // page 0: the feed (home_activity.xml's `videos` list)
    const list = el('div', '', { position: 'absolute', inset: '0', overflowY: 'auto', background: 'url(apps/v33/res/drawable-hdpi-v4/bg_stripes_light.png)', backgroundSize: '' });
    list.style.backgroundImage = 'none';
    const lbg = el('div'); list.appendChild(lbg);
    for (const v of VIDEOS) { const it = await videoItem(v); list.appendChild(it); list.appendChild(el('div', '', { height: '1px', background: '#d0d0d0' })); }
    pages.push(list);
    // page 1: categories
    const cats = el('div', '', { position: 'absolute', inset: '0', overflowY: 'auto' });
    for (const c of ['Autos & Vehicles', 'Comedy', 'Education', 'Entertainment', 'Film & Animation', 'Gaming', 'Music', 'News & Politics', 'Science & Technology', 'Sports']) {
      const row = el('div', '', { height: '48px', display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '18px', color: '#000', borderBottom: '1px solid #bbb' }); row.textContent = c; cats.appendChild(row);
    }
    pages.push(cats);
    // page 2: account (my_channel_header + stack buttons, original XML)
    const acc = el('div', '', { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column' });
    acc.appendChild(await V.inflate('my_channel_header', null));
    pages.push(acc);
    pages.forEach(p => content.appendChild(p));
    function show(i) { pages.forEach((p, k) => p.style.display = k === i ? (k === 2 ? 'flex' : 'block') : 'none'); bar.__select(i); V.layoutTree(screen); }
    show(0);
    document.fonts.ready.then(() => V.layoutTree(screen));
    V.layoutTree(screen);
    new ResizeObserver(() => V.layoutTree(screen)).observe(screen);
  }
  await home();
})().catch(e => { document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f55;position:fixed;top:0;background:#000;padding:8px;z-index:9;white-space:pre-wrap">' + (e.stack || e) + '</pre>'); });
