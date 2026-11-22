// SPDX-License-Identifier: GPL-3.0-or-later
// YouTube 2.2.14 UI. Layouts, drawables, strings, colors come from the original APK resources.
(async function () {
  const RT = window.AndroidRT, V = window.Views, D = window.DATA, screen = document.getElementById('screen');
  await RT.loadValues();
  const S = n => RT.R.string[n] || n;
  const fmtS = (n, ...a) => S(n).replace(/%(\d)\$,?[ds]/g, (m, i) => (/,d/.test(m) ? D.fmt(a[i - 1]) : a[i - 1])).replace(/\\'/g, "'");
  const el = (tag, cls, css) => { const e = document.createElement(tag); if (cls) e.className = cls; if (css) Object.assign(e.style, css); return e; };
  const img = (name, hd = true) => `url(apps/v22/res/drawable-hdpi-v4/${name}.png)`;
  const dpr = 1.5;
  const sizeOf = async name => { const d = await RT.drawable('@drawable/' + name); return RT.intrinsic(d); };

  // ---- shell: app area + emulated Android key row (Back / Menu), outside the app UI ----
  screen.replaceChildren();
  const app = el('div', 'appview', { flex: '1', position: 'relative', overflow: 'hidden', background: '#000' });
  const keys = el('div', 'keys', { flex: '0 0 auto', height: '38px', display: 'flex', justifyContent: 'space-around', alignItems: 'center', background: '#111', borderTop: '1px solid #222', paddingBottom: 'env(safe-area-inset-bottom)' });
  const keyBtn = (label, fn) => { const b = el('div', '', { flex: '1', textAlign: 'center', color: '#8a8a8a', fontSize: '18px', lineHeight: '38px', cursor: 'pointer', userSelect: 'none' }); b.textContent = label; b.onclick = fn; keys.appendChild(b); return b; };
  keyBtn('◁', () => history.back());
  keyBtn('☰', () => toggleMenu());
  // Tablet mode: layouts follow YouTube 3.x for Honeycomb tablets (layout-sw600dp): video grids, player with info on the left, related on the right.
  let TABLET = localStorage.tablet_mode === '1';
  const applyMode = () => { screen.classList.toggle('tablet', TABLET); tabKey.textContent = TABLET ? '▯' : '▭'; tabKey.title = TABLET ? 'Phone mode' : 'Tablet mode'; };
  const tabKey = keyBtn('▭', () => { TABLET = !TABLET; localStorage.tablet_mode = TABLET ? '1' : '0'; applyMode(); toast(TABLET ? 'Tablet mode' : 'Phone mode'); render(history.state || { name: 'home' }); });
  applyMode();
  screen.appendChild(app); screen.appendChild(keys);

  // ---- navigation (browser history = Android back stack) ----
  const routes = {};
  let current = null;
  async function go(name, arg, replace) {
    const st = { name, arg };
    if (replace) history.replaceState(st, ''); else history.pushState(st, '');
    await render(st);
  }
  async function render(st) {
    closeMenu(); closeSearch(); closeDialogs();
    const prev = current && current.cleanup; if (prev) prev();
    app.replaceChildren();
    const root = await routes[st.name](st.arg || {});
    current = { root, cleanup: root.__cleanup };
    root.style.width = '100%'; root.style.height = '100%';
    app.appendChild(root);
    const relayout = () => V.layoutTree(root);
    relayout(); document.fonts.ready.then(relayout); requestAnimationFrame(relayout);
    new ResizeObserver(relayout).observe(app);
  }
  window.addEventListener('popstate', e => render(e.state || { name: 'home' }));

  // ---- shared widgets ----
  async function iconBtn(drawableRef, onClick) {
    const d = await RT.drawable(drawableRef);
    const b = el('div', 'ib', { height: '51px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', cursor: 'pointer' });
    const i = el('div'); b.appendChild(i);
    const set = st => { const p = RT.pick(d, st); i.style.width = p.w + 'px'; i.style.height = p.h + 'px'; i.style.background = `url(${p.url}) center/100% 100% no-repeat`; };
    set({}); b.addEventListener('pointerdown', () => set({ pressed: true })); ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => b.addEventListener(e, () => set({})));
    b.onclick = onClick; return b;
  }
  async function textBtn(label, onClick, withIcon) {
    const b = el('div', 'hb', { height: '51px', display: 'flex', alignItems: 'center', padding: '0 6px', fontSize: '13px', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' });
    if (withIcon) { const d = await RT.drawable('@drawable/more_drawable'); const p = RT.pick(d, {}); const i = el('div', '', { width: p.w + 'px', height: p.h + 'px', background: `url(${p.url}) center/100% 100%`, marginRight: '4px' }); b.appendChild(i); }
    b.appendChild(document.createTextNode(label)); b.onclick = onClick; return b;
  }
  async function header(root, { title, buttons = [] } = {}) {
    const h = V.find(root, 'header_buttons'); const logo = V.find(root, 'header_logo');
    logo.style.cursor = 'pointer'; logo.onclick = () => go('home');
    for (const b of buttons) h.appendChild(b);
    if (title) { const t = V.find(root, 'header_title'); t.querySelector('.t').textContent = title; V.setVisible(t, true); }
  }
  const homeButtons = async () => [await iconBtn('@drawable/search_drawable', () => openSearch())];

  // list item pressed state ("duplicateParentState")
  function pressable(item) {
    const all = [item, ...item.querySelectorAll('.v')];
    const set = v => all.forEach(e => e.__state && V.setState(e, 'pressed', v));
    item.addEventListener('pointerdown', () => { set(true); item.style.background = 'linear-gradient(#ffd27a,#ffa40c)'; });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => item.addEventListener(e, () => { set(false); item.style.background = ''; }));
  }
  const thumbCss = (e, v) => { e.__img.dataset.thumb = v.thumb; e.__img.classList.add('lazy-thumb'); e.__img.style.backgroundSize = 'cover'; };
  async function videoItem(v) {
    const it = await V.inflate('video_item', null);
    const t = id => V.find(it, id);
    t('title').querySelector('.t').textContent = v.title;
    t('author').querySelector('.t').textContent = fmtS('video_author', v.author);
    t('detail').querySelector('.t').textContent = v.views ? fmtS('age_and_views', v.date || '', v.views) : (v.date || '');
    t('duration').querySelector('.t').textContent = v.live ? 'LIVE' : D.dur(v.dur);
    if (!v.dur && !v.live) V.setVisible(t('duration'), false);
    thumbCss(t('thumbnail'), v);
    it.style.width = '100%'; it.__lp.layout_width = 'match_parent';
    pressable(it); it.style.cursor = 'pointer';
    it.onclick = () => go('watch', { id: v.id });
    return it;
  }
  async function simpleItem(layout, text, onClick) {
    const it = await V.inflate(layout, null);
    V.find(it, 'title').querySelector('.t').textContent = text;
    pressable(it); it.style.cursor = 'pointer'; if (onClick) it.onclick = onClick; return it;
  }
  const divider = () => el('div', '', { height: '1px', background: '#2a2a2a' });
  // Tablet grid card. Geometry from YouTube 3.3.0 layout-sw600dp/video_item.xml: 228dp wide, 128dp thumbnail, duration strip over the thumbnail, title below.
  function videoCard(v) {
    const c = el('div', 'card', { position: 'relative', cursor: 'pointer', background: '#111', border: '1px solid #2a2a2a', paddingBottom: '6px', minWidth: '0' });
    const th = el('div', 'lazy-thumb', { position: 'relative', width: '100%', aspectRatio: '228/128', background: '#000 center/cover no-repeat' }); th.dataset.thumb = v.thumb;
    const du = el('div', '', { position: 'absolute', left: 0, right: 0, bottom: 0, padding: '2px 4px', fontSize: '12px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.6)', textAlign: 'right' }); du.textContent = v.live ? 'LIVE' : D.dur(v.dur); if (v.dur || v.live) th.appendChild(du);
    const t = el('div', '', { padding: '4px 4px 0', fontSize: '13px', fontWeight: 700, color: '#fff', lineHeight: 1.2, height: 'calc(2.4em + 4px)', boxSizing: 'border-box', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }); t.textContent = v.title;
    const a = el('div', '', { padding: '2px 4px 0', fontSize: '12px', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); a.textContent = fmtS('video_author', v.author);
    const d = el('div', '', { padding: '0 4px', fontSize: '12px', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); d.textContent = v.views ? fmtS('age_and_views', v.date || '', v.views) : (v.date || '');
    c.append(th, t, a, d);
    c.addEventListener('pointerdown', () => c.style.background = 'linear-gradient(#ffd27a,#ffa40c)'); ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => c.addEventListener(e, () => c.style.background = '#111'));
    c.onclick = () => go('watch', { id: v.id }); return c;
  }
  // Endless lists. A session budget limits how much is loaded: at most BUDGET.max video items (fewer on iOS, which kills tabs
  // that use too much memory) or 70% of the JS heap where the browser reports it. Reloading the page resets the budget.
  const IOS_LIKE = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const BUDGET = { loaded: 0, max: IOS_LIKE ? 600 : 1500 };
  const memoryLow = () => { const m = performance.memory; if (m && m.jsHeapSizeLimit && m.usedJSHeapSize / m.jsHeapSizeLimit > 0.7) return true; return BUDGET.loaded >= BUDGET.max; };
  async function fillList(list, src, maker, emptyMsg, cols) {
    const page = Array.isArray(src) ? { items: src, more: null } : (src || { items: [], more: null });
    if (list.__onScroll) list.removeEventListener('scroll', list.__onScroll);
    if (list.__io) list.__io.disconnect();
    list.replaceChildren();
    const grid = TABLET && maker === videoItem && page.items.length;
    if (grid) Object.assign(list.style, { display: 'grid', gridTemplateColumns: cols ? `repeat(${cols}, minmax(0,1fr))` : 'repeat(auto-fill, minmax(200px, 1fr))', gridTemplateRows: 'none', gridAutoRows: 'auto',
      justifyItems: 'stretch', alignItems: 'stretch', gap: '6px', padding: '12px 16px', alignContent: 'start', overflowY: 'auto' });
    if (!page.items.length && !page.more) { const m = el('div', '', { padding: '20px', textAlign: 'center', color: '#888', fontSize: '15px' }); m.textContent = S(emptyMsg || 'no_videos_found'); list.appendChild(m); return; }
    // thumbnails are set only near the visible area and dropped again far away, so decoded images do not pile up
    const io = new IntersectionObserver(es => es.forEach(e => { const t = e.target; t.style.backgroundImage = e.isIntersecting ? `url(${t.dataset.thumb})` : ''; }), { root: list, rootMargin: '600px 0px' });
    list.__io = io;
    const footer = el('div', 'list-footer', { padding: '14px', textAlign: 'center', color: '#888', fontSize: '14px', gridColumn: '1 / -1', display: 'none' });
    list.appendChild(footer);
    const seen = new Set(); let more = page.more, busy = false;
    const isVideo = maker === videoItem;
    async function add(items) {
      const added = [];
      for (const x of items) {
        if (x && x.id) { if (seen.has(x.id)) continue; seen.add(x.id); }
        const node = grid ? videoCard(x) : await maker(x);
        list.insertBefore(node, footer); if (!grid) list.insertBefore(divider(), footer);
        node.querySelectorAll('.lazy-thumb').forEach(t => io.observe(t)); if (node.classList.contains('lazy-thumb')) io.observe(node);
        added.push(node); if (isVideo) BUDGET.loaded++;
      }
      if (list.isConnected) added.forEach(n => V.layoutTree(n));
    }
    const status = (txt, onTap) => { footer.style.display = txt ? 'block' : 'none'; footer.replaceChildren(); if (!txt) return; footer.textContent = txt; footer.onclick = onTap || null; footer.style.cursor = onTap ? 'pointer' : ''; };
    async function maybeMore() {
      if (busy || !more || !list.isConnected || !list.clientHeight) return;
      if (list.scrollTop + list.clientHeight < list.scrollHeight - 900) return;
      if (memoryLow()) { more = null; return status('The list is full. Refresh the page to load more.'); }
      busy = true; footer.style.display = 'block'; footer.replaceChildren(el('div', 'spinner', { width: '24px', height: '24px', margin: '0 auto', borderColor: 'rgba(255,255,255,.2)', borderTopColor: '#fff' }));
      const loader = more;
      try { const p = await loader(); more = p.more; await add(p.items); status(''); }
      catch (e) { status('Could not load more. Tap to retry.', () => { more = loader; status(''); maybeMore(); }); more = null; }
      busy = false;
      requestAnimationFrame(maybeMore);   // keep going until the screen is filled
    }
    list.__onScroll = maybeMore; list.__maybeMore = maybeMore;
    list.addEventListener('scroll', maybeMore, { passive: true });
    await add(page.items);
    setTimeout(maybeMore, 300);
  }

  // TabRow + Workspace (swipe between pages)
  async function tabs(root, labels, pages) {
    const row = V.find(root, 'tabrow'); const ws = V.find(root, 'workspace');
    const d = await RT.drawable('@drawable/tab_drawable'); const pad = RT.bgPadding(d);
    row.style.display = 'flex'; const els = [];
    for (let i = 0; i < labels.length; i++) {
      const t = await V.inflate('tab', null, {}); t.__bg = d; { const hs = [RT.pick(d, {}), RT.pick(d, { selected: true })].map(x => x && x.kind === 'nine' ? x.n.ch / x.n.sc : 0); t.style.minHeight = Math.max(...hs) + 'px'; } if (pad) t.style.padding = `${pad.t}px ${pad.r}px ${pad.b}px ${pad.l}px`;
      t.__text.textContent = labels[i]; t.style.flex = '1 1 0'; t.style.minWidth = '0'; t.style.width = 'auto'; t.style.justifyContent = 'center';
      t.__text.style.textAlign = 'center'; t.style.cursor = 'pointer';
      t.addEventListener('pointerdown', () => V.setState(t, 'pressed', true)); ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => t.addEventListener(e, () => V.setState(t, 'pressed', false)));
      t.onclick = () => sel(i); row.appendChild(t); els.push(t);
    }
    let cur = 0;
    function sel(i) { cur = i; els.forEach((t, k) => V.setState(t, 'selected', k === i)); pages.forEach((p, k) => { p.style.display = k === i ? (p.__disp || 'block') : 'none'; }); V.layoutTree(root); const p = pages[i]; setTimeout(() => p.__maybeMore && p.__maybeMore(), 50); }
    pages.forEach(p => { p.__disp = p.style.display && p.style.display !== 'none' ? p.style.display : 'block'; ws.appendChild(p); });
    sel(0);
    let sx = 0, sy = 0;
    ws.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    ws.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) sel(Math.max(0, Math.min(labels.length - 1, cur + (dx < 0 ? 1 : -1)))); }, { passive: true });
    return sel;
  }
  const newPage = () => el('div', 'page', { position: 'absolute', inset: '0', overflowY: 'auto', display: 'block' });

  // ---- screens ----
  routes.home = async () => {
    const root = await V.inflate('home_activity', null); await header(root, { buttons: await homeButtons() });
    await fillList(V.find(root, 'videos'), await API.home(), videoItem); return root;
  };
  routes.results = async ({ q }) => {
    const root = await V.inflate('results_activity', null); await header(root, { buttons: await homeButtons(), title: q });
    await fillList(V.find(root, 'videos'), await API.search(q || ''), videoItem); return root;
  };
  routes.categories = async () => {
    const root = await V.inflate('categories_activity', null); await header(root, { buttons: await homeButtons() });
    const list = V.find(root, 'categories');
    if (TABLET) {
      // layout-sw600dp/browse_controller.xml: category sidebar (232dp) + video grid
      const body = el('div', '', { display: 'flex', flex: '1 1 0', minHeight: '0', width: '100%' });
      const side = el('div', '', { flex: '0 0 232px', margin: '0 28px', overflowY: 'auto', paddingTop: '8px' });
      const grid = el('div', '', { flex: '1 1 0', minWidth: '0', overflowY: 'auto' });
      list.parentNode.insertBefore(body, list); list.remove(); body.append(side, grid);
      const items = [];
      const pick = async (c, it) => { items.forEach(x => { x.style.background = ''; x.style.color = '#fff'; }); it.style.background = 'linear-gradient(#ffd27a,#ffa40c)'; it.style.color = '#000'; await fillList(grid, await API.search(c), videoItem); };
      for (const c of D.categories) { const it = el('div', '', { padding: '12px 10px', fontSize: '17px', cursor: 'pointer', borderBottom: '1px solid #222', color: '#fff' }); it.textContent = c; it.onclick = () => pick(c, it); side.appendChild(it); items.push(it); }
      pick(D.categories[0], items[0]);
      return root;
    }
    for (const c of D.categories) { const it = await V.inflate('category_item', null); it.querySelector('.t').textContent = c; pressable(it); it.style.cursor = 'pointer'; it.onclick = () => go('browse', { category: c }); list.appendChild(it); list.appendChild(divider()); }
    return root;
  };
  routes.browse = async ({ category }) => {
    const root = await V.inflate('browse_activity', null); await header(root, { buttons: await homeButtons(), title: category });
    const names = ['most_viewed_videos', 'top_rated_videos', 'most_discussed_videos', 'top_favorited_videos'];
    const pages = []; const suffix = ['', ' best', ' popular', ' top']; 
    const lists = await Promise.all(suffix.map(s => API.search(category + s)));
    for (let i = 0; i < 4; i++) { const p = newPage(); await fillList(p, lists[i], videoItem); pages.push(p); }
    await tabs(root, names.map(S), pages); return root;
  };
  // Channel screens with real data. Own channel: needs a sign-in; tabs Uploads / Favorites (liked videos) /
  // Playlists / Subscriptions. Other channels: Uploads / Favorites (empty, YouTube dropped them) / Activity (live) / Playlists.
  async function playlistItem(p) { const it = await simpleItem('playlist_item', p.title + (p.count ? '  (' + p.count + ')' : ''), () => go('playlist', { pid: p.pid, title: p.title })); return it; }
  async function channelItem(c) { const it = await simpleItem('subscription_item', c.title, () => go('channel', { cid: c.cid, who: c.title })); return it; }
  async function channelScreen(layout, who, own, cid) {
    const root = await V.inflate(layout, null);
    await header(root, { buttons: await homeButtons() });
    const set = (id, html) => { V.find(root, id).querySelector('.t').innerHTML = html; };
    const stat = (name, n) => fmtS(name, n).replace(/<font color='(\w+)'>/g, '<span style="color:$1">').replace(/<\/font>/g, '</span>');
    const av = V.find(root, 'channel_avatar'); av.style.background = '#222'; av.__img.style.backgroundSize = 'cover';
    const setAvatar = url => { av.__img.style.backgroundImage = `url(${url ? '/avatar?u=' + btoa(url.replace(/=s\d+-/, '=s176-')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : 'apps/v22/res/drawable-hdpi-v4/ic_launcher_youtube.png'})`; };
    const up = newPage(), fav = newPage(), pl = newPage(), extra = newPage();
    let meInfo = null;
    if (own) {
      const st = await API.authStatus(); meInfo = st.signedIn ? st.profile : null;
      if (!meInfo) {
        V.find(root, 'channel_title').querySelector('.t').textContent = 'Not signed in';
        set('channel_views', 'Settings → Google account'); set('channel_uploaded', ''); set('channel_subscribers', ''); setAvatar(null);
        [up, fav, pl, extra].forEach(p => { const m = el('div', '', { padding: '20px', textAlign: 'center', color: '#888', fontSize: '15px' }); m.textContent = 'Sign in to see your channel'; p.appendChild(m); });
      } else cid = meInfo.cid;
    } else if (!cid && who) cid = (await API.findChannel(who)).cid;
    if (cid) {
      const [ch, vids, pls] = await Promise.all([API.channel(cid).catch(() => null), API.channelTab(cid, 'videos').catch(() => ({ items: [], more: null })), API.channelTab(cid, 'playlists').catch(() => ({ items: [], more: null }))]);
      const title = (ch && ch.title) || (meInfo && meInfo.name) || who || '';
      V.find(root, 'channel_title').querySelector('.t').textContent = title;
      set('channel_views', (ch && ch.handle) || (meInfo && meInfo.handle) || '');
      set('channel_uploaded', ch && ch.videos ? stat('channel_stats_uploaded', ch.videos) : S('channel_stats_uploaded_empty'));
      set('channel_subscribers', ch && ch.subscribers ? stat('channel_stats_subscribers', ch.subscribers) : S('channel_stats_subscribers_empty'));
      setAvatar((ch && ch.avatar) || (meInfo && meInfo.avatar));
      vids.items = vids.items.map(x => ({ ...x, author: x.author || title }));
      await fillList(up, vids, videoItem, 'no_uploads_found');
      await fillList(pl, pls, playlistItem, 'no_playlists_found');
      if (own) {
        const [lk, subs] = await Promise.all([API.liked(), API.subscriptions()]);
        await fillList(fav, lk, videoItem, 'no_favorites_found');
        await fillList(extra, subs, channelItem, 'no_subscriptions_found');
      } else {
        await fillList(fav, [], null, 'no_favorites_found');
        await fillList(extra, await API.channelTab(cid, 'live').catch(() => []), videoItem, 'no_events_found');
      }
    } else if (!own || meInfo) {
      V.find(root, 'channel_title').querySelector('.t').textContent = (meInfo && meInfo.name) || who || '';
      setAvatar(meInfo && meInfo.avatar); set('channel_views', ''); set('channel_uploaded', ''); set('channel_subscribers', '');
      await fillList(up, [], null, 'no_uploads_found'); await fillList(fav, [], null, 'no_favorites_found'); await fillList(pl, [], null, 'no_playlists_found'); await fillList(extra, [], null, own ? 'no_subscriptions_found' : 'no_events_found');
    }
    const labels = own ? ['channel_uploads', 'channel_favorites', 'channel_playlists', 'channel_subscriptions'] : ['channel_uploads', 'channel_favorites', 'channel_activity', 'channel_playlists'];
    const pages = own ? [up, fav, pl, extra] : [up, fav, extra, pl];
    if (TABLET) {
      // layout-sw600dp/channel_sidebar.xml: channel info in a 272dp sidebar, lists on the right
      const hdr = V.find(root, 'channel_title').closest('.LinearLayout').parentElement;
      const body = el('div', '', { display: 'flex', flex: '1 1 0', minHeight: '0', width: '100%' });
      const side = el('div', '', { flex: '0 0 272px', margin: '16px 0 14px 16px', borderRight: '1px solid #222', overflow: 'hidden' });
      const right = el('div', '', { flex: '1 1 0', display: 'flex', flexDirection: 'column', minWidth: '0' });
      const tabrow = V.find(root, 'tabrow'), ws = V.find(root, 'workspace');
      hdr.parentNode.insertBefore(body, hdr); side.appendChild(hdr); hdr.style.flexDirection = 'column'; hdr.style.alignItems = 'flex-start'; hdr.style.width = '100%';
      right.append(tabrow, ws); ws.style.flex = '1 1 0'; ws.style.minHeight = '0'; ws.style.height = 'auto'; ws.style.position = 'relative';
      body.append(side, right);
    }
    await tabs(root, labels.map(S), pages); return root;
  }
  routes.mychannel = () => channelScreen('my_channel_activity', null, true);
  routes.channel = ({ who, cid }) => channelScreen('channel_activity', who, false, cid);
  routes.playlist = async ({ pid, title }) => {
    const root = await V.inflate('results_activity', null);
    const p = await API.playlist(pid).catch(() => ({ title: title || '', items: [], more: null }));
    await header(root, { buttons: await homeButtons(), title: p.title || title || '' });
    await fillList(V.find(root, 'videos'), p, videoItem); return root;
  };

  // ---- watch ----
  routes.watch = async ({ id }) => {
    const v = await API.video(id);
    const root = await V.inflate('watch_activity', null);
    await header(root, { buttons: [await textBtn(S('header_more'), () => openToolbar(v), true), await iconBtn('@drawable/search_drawable', () => openSearch())] });
    // player placeholder in layout: replace with our view
    const ph = V.find(root, 'player'); const player = await buildPlayer(v); ph.replaceWith(player);
    root.__cleanup = () => { player.__disposeSource(); const vid = player.querySelector('video'); if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); } };
    // info
    const info = V.find(root, 'info_layout'); V.setVisible(info, true); V.setVisible(V.find(root, 'info_status'), false);
    const set = (i, t) => { const e = V.find(root, i); if (e) e.querySelector('.t').textContent = t; };
    set('title', v.title); set('date_added', v.date);
    set('views_likes_dislikes', fmtS('num_views_likes_and_dislikes', v.views, v.likes, v.dislikes));
    set('channel', v.author); set('description', v.desc); set('category', v.category || '-'); set('tags', v.tags || '-');
    const ch = V.find(root, 'channel');
    Object.assign(ch.parentElement.style, { alignSelf: 'flex-start', maxWidth: '100%', cursor: 'default' });
    Object.assign(ch.style, { padding: '0 14px', cursor: 'pointer', flexShrink: '1', minWidth: '0' });
    ch.setAttribute('role', 'button');
    ch.tabIndex = 0;
    ch.onclick = () => go('channel', { who: v.author, cid: v.channelId });
    ch.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) ch.click();
      }
    });
    const ws = V.find(root, 'workspace');
    const infoPage = ws.querySelector('[data-id="watch_video_info"]');
    const related = V.find(root, 'related'), comments = V.find(root, 'comments');
    await fillList(related, v.relatedPage, videoItem);
    const cm = v.commentsPage || await API.comments(v.commentsToken);
    const add = await V.inflate('add_comment_button', null).catch(() => null);
    const addBtn = el('div', '', { margin: '6px 5px', padding: '12px', textAlign: 'center', fontSize: '13px', cursor: 'pointer', color: '#fff', border: '1px solid #444', borderRadius: '6px', background: 'linear-gradient(#444,#222)' }); addBtn.textContent = S('comment_hint'); addBtn.onclick = () => commentDialog(comments, v);
    const commentItem = async c => { const it = await V.inflate('comment_item', null); V.find(it, 'author').querySelector('.t').textContent = c.author; V.find(it, 'comment').querySelector('.t').textContent = c.text; V.find(it, 'time').querySelector('.t').textContent = c.time; return it; };
    await fillList(comments, cm, commentItem, 'no_comments_found'); comments.prepend(addBtn);
    // pages: tabs from the original tag strings
    const pages = [infoPage, related, comments]; pages.forEach(p => { p.style.width = '100%'; p.style.height = '100%'; });
    infoPage.style.display = 'grid'; infoPage.__disp = 'grid';
    // Streams and stream recordings: the leftmost tab is the chat, with the related videos below it.
    let chatPage = null;
    if (v.chat && !v.demo) {
      const chat = makeChat(v, player.querySelector('video')); player.__chat = chat;
      const prevCleanup = root.__cleanup; root.__cleanup = () => { chat.stop(); prevCleanup && prevCleanup(); };
      chatPage = el('div', 'chat-page', { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: '0' });
      chat.el.style.flex = '0 0 55%'; chat.el.style.borderBottom = '1px solid #333';
      const relHead = el('div', '', { background: 'linear-gradient(#555,#222)', color: '#fff', fontSize: '14px', padding: '2px 8px', flex: '0 0 auto' }); relHead.textContent = S('video_info_related_label_text');
      chatPage.append(chat.el, relHead, related);
      Object.assign(related.style, { flex: '1 1 0', minHeight: '0', height: 'auto', width: '100%', position: 'relative', overflowY: 'auto' });
      chatPage.__disp = 'flex';
      chat.start();
    }
    if (TABLET) {
      // layout-sw600dp/watch_controller.xml: player + info on the left, Related (2-column grid) / Comments tabs on the right
      await fillList(related, v.relatedPage, videoItem, null, 2);
      const body = el('div', '', { display: 'flex', flex: '1 1 0', minHeight: '0', width: '100%' });
      const left = el('div', '', { flex: '0 0 58%', display: 'flex', flexDirection: 'column', minWidth: '0', borderRight: '1px solid #222' });
      const right = el('div', '', { flex: '1 1 0', display: 'flex', flexDirection: 'column', minWidth: '0' });
      const tabrow = V.find(root, 'tabrow');
      player.parentNode.insertBefore(body, player); left.appendChild(player);
      infoPage.style.flex = '1 1 0'; infoPage.style.minHeight = '0'; infoPage.style.height = 'auto'; left.appendChild(infoPage);
      right.append(tabrow, ws); ws.style.flex = '1 1 0'; ws.style.minHeight = '0'; ws.style.height = 'auto'; ws.style.position = 'relative';
      body.append(left, right);
      if (chatPage) {
        Object.assign(chatPage.style, { position: 'absolute', inset: '0', height: 'auto' }); comments.style.position = 'absolute'; comments.style.inset = '0'; comments.style.height = 'auto';
        await tabs(root, [player.__chat.title, S('comments')], [chatPage, comments]);
        infoPage.style.display = 'grid'; return root;
      }
      [related, comments].forEach(p => { p.style.position = 'absolute'; p.style.inset = '0'; p.style.height = 'auto'; });
      await tabs(root, [S('video_info_related_label_text'), S('comments')], [related, comments]);
      infoPage.style.display = 'grid';
      return root;
    }
    if (chatPage) { await tabs(root, [player.__chat.title, S('video_info'), S('comments')], [chatPage, infoPage, comments]); return root; }
    await tabs(root, [S('video_info'), S('video_info_related_label_text'), S('comments')], pages);
    return root;
  };

  let hlsScript;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    return hlsScript ||= new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'lib/hls.min.js'; s.onload = ok; s.onerror = no;
      document.body.appendChild(s);
    }).catch(error => { hlsScript = null; throw error; });
  }
  const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
  async function attachSource(P, vid, v, source, playback, onReady, onFail) {
    P.__cancelSource();
    const controller = new AbortController();
    const { signal } = controller;
    P.__cancelSource = () => {
      controller.abort();
      if (P.__hls) { P.__hls.destroy(); P.__hls = null; }
    };
    const fallback = () => {
      if (signal.aborted) return;
      if (v.live && !source.track && !source.liveFallback) {
        return attachSource(P, vid, v, { ...source, liveFallback: true }, playback, onReady, onFail);
      }
      P.__cancelSource();
      onFail();
    };
    const listen = { once: true, signal };
    const ready = () => {
      if (!v.live && playback.time > 0) { try { vid.currentTime = playback.time; } catch (e) {} }
      vid.defaultPlaybackRate = vid.playbackRate = P.__rate || 1;
      onReady();
      if (!playback.paused) vid.play().catch(() => {});
    };
    const setSrc = url => {
      vid.addEventListener('loadedmetadata', ready, listen);
      vid.addEventListener('error', fallback, listen);
      vid.src = url;
    };
    if (source.progressive) return setSrc(v.src);
    const params = new URLSearchParams();
    if (source.quality !== 'auto') params.set('h', source.quality);
    if (source.track) params.set('a', source.track);
    const route = v.live ? (source.liveFallback || source.track ? '/hls/' : '/ldvr/') : '/qhls/';
    const url = route + v.id + '.m3u8?' + params;
    if (isApple && vid.canPlayType('application/vnd.apple.mpegurl')) return setSrc(url);
    try { await loadHls(); } catch (e) {}
    if (signal.aborted) return;
    if (window.Hls && Hls.isSupported()) {
      const h = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 3, capLevelToPlayerSize: false, maxBufferLength: 30 });
      P.__hls = h;
      h.on(Hls.Events.ERROR, (e, d) => {
        if (!d.fatal || signal.aborted) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !h.__recovered) {
          h.__recovered = true;
          h.recoverMediaError();
        } else fallback();
      });
      vid.addEventListener('loadedmetadata', ready, listen);
      h.loadSource(url); h.attachMedia(vid); return;
    }
    if (vid.canPlayType('application/vnd.apple.mpegurl')) return setSrc(url);
    fallback();
  }
  const fmtTime = s => D.dur(Math.max(0, Math.floor(s || 0)));
  async function buildPlayer(v) {
    const P = el('div', 'player', { position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', marginBottom: '1px', overflow: 'hidden', flex: '0 0 auto', touchAction: 'manipulation' });
    const vid = el('video', '', { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
    vid.poster = v.thumb;
    vid.playsInline = true; vid.preload = 'auto'; vid.setAttribute('webkit-playsinline', ''); vid.setAttribute('playsinline', ''); P.appendChild(vid);
    const hud = el('div', 'hud', { position: 'absolute', inset: '0', transition: 'opacity .25s' }); P.appendChild(hud);
    const shade = el('div', '', { position: 'absolute', left: 0, right: 0, bottom: 0, height: '56px', background: 'linear-gradient(transparent,rgba(0,0,0,.65))' }); hud.appendChild(shade);
    const center = el('div', '', { position: 'absolute', left: '50%', top: '50%', width: '166px', height: '166px', margin: '-83px 0 0 -83px', background: `url(apps/v22/res/drawable-hdpi-v4/video_hud_center.png) center/100% 100%`, cursor: 'pointer' }); hud.appendChild(center);
    const glyph = el('div', '', { position: 'absolute', left: '50%', top: '50%', backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%', pointerEvents: 'none' });
    center.appendChild(glyph);
    const setGlyph = playing => {
      glyph.style.width = (playing ? 65 : 166) / 1.5 + 'px';
      glyph.style.height = (playing ? 73 : 166) / 1.5 + 'px';
      // Align the visible glyphs within the HDPI sprites, accounting for their transparent padding.
      glyph.style.transform = playing ? 'translate(calc(-50% - 5.67px), calc(-50% - 9.67px))' : 'translate(-50%, -50%)';
      glyph.style.backgroundImage = `url(apps/v22/res/drawable-hdpi-v4/ic_vidcontrol_${playing ? 'pause' : 'play'}.png)`;
    };
    const side = async (nm, dx, fn) => { const d = await RT.drawable('@drawable/' + nm); const p = RT.pick(d, {}) || d; const b = el('div', '', { position: 'absolute', left: `calc(50% + ${dx}px)`, top: '50%', width: p.w + 'px', height: p.h + 'px', margin: `${-p.h / 2}px 0 0 ${-p.w / 2}px`, background: `url(apps/v22/res/drawable-hdpi-v4/${nm}.png) center/100% 100%`, cursor: 'pointer' }); b.onclick = e => { e.stopPropagation(); fn(); }; hud.appendChild(b); };
    const nextV = (v.related || [])[0];
    await side('ic_vidcontrol_prev', -96, () => vid.currentTime = 0);
    await side('ic_vidcontrol_next', 96, () => nextV && go('watch', { id: nextV.id }, true));
    const controls = el('div', 'player-controls');
    hud.appendChild(controls);
    const bar = el('div', 'player-scrubber');
    const times = { marginBottom: '1px', fontSize: '12px', color: '#fff' };
    const prog = el('div', '', { position: 'absolute', left: 0, top: 0, bottom: 0, width: '0', background: '#dd0000' }); bar.appendChild(prog);
    const knob = el('div', '', { position: 'absolute', top: '-30px', width: '24px', height: '37px', marginLeft: '-12px', background: `url(apps/v22/res/drawable-hdpi-v4/scrubber_knob.png) center/100% 100% no-repeat`, left: 0 }); bar.appendChild(knob);
    const tcur = el('div', '', times); tcur.textContent = '0:00';
    const ttot = el('div', '', times); ttot.textContent = v.live ? '' : fmtTime(v.dur);
    const fs = el('div', '', { marginBottom: '1px', width: '32px', height: '33px', background: `url(apps/v22/res/drawable-hdpi-v4/ic_vidcontrol_fullscreenoff.png) center/100% 100%`, cursor: 'pointer' });
    const hq = el('div', '', { position: 'absolute', right: '6px', top: '4px', width: '47px', height: '40px', background: `url(apps/v22/res/drawable-hdpi-v4/btn_hq_off.png) center/100% 100%`, cursor: 'pointer' }); hud.appendChild(hq);
    // Live: the bar covers the rewind window; the time shows how far behind live you are; tapping LIVE jumps to the live edge.
    let liveBadge = null;
    if (v.live) {
      liveBadge = el('div', '', { marginBottom: '2px', fontSize: '12px', fontWeight: 700, color: '#fff', background: '#cc0000', padding: '2px 6px', borderRadius: '2px', cursor: 'pointer' });
      liveBadge.textContent = 'LIVE';
      liveBadge.addEventListener('click', e => { e.stopPropagation(); const r = rng(); vid.currentTime = (P.__hls && P.__hls.liveSyncPosition) || Math.max(r[0], r[1] - 12); vid.play().catch(() => {}); show(); });
    }
    // ---- quality: button at the bottom (painted with the app's own button_background drawable) + list dialog ----
    const qBtn = el('div', 'player-quality', { position: 'relative', minWidth: '44px', height: '26px', padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff', cursor: 'pointer', isolation: 'isolate' });
    const btnD = await RT.drawable('@drawable/button_background');
    const stylePlayerButton = button => {
      const bg = el('div');
      button.appendChild(bg);
      const paint = st => {
        RT.paint(bg, btnD, st);
        bg.style.borderWidth = '6px';
        bg.style.borderImageWidth = '6px';
      };
      paint({});
      button.addEventListener('pointerdown', () => paint({ pressed: true }));
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => button.addEventListener(e, () => paint({})));
    };
    stylePlayerButton(qBtn);
    const qLabel = el('span');
    qBtn.appendChild(qLabel);

    const volume = el('details', 'player-volume');
    const volumeToggle = el('summary', 'player-volume-button');
    volumeToggle.textContent = 'Volume';
    stylePlayerButton(volumeToggle);
    const volumePanel = el('div', 'player-volume-panel');
    volume.append(volumeToggle, volumePanel);
    controls.append(liveBadge || tcur, bar, ttot, volume, qBtn, fs);

    // Some browsers route volume changes through the OS and ignore the media element setter.
    vid.volume = 0.5;
    if (vid.volume === 0.5) {
      const savedVolume = Number(localStorage.getItem('player_volume') ?? 100);
      vid.volume = Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) / 100 : 1;
      const slider = el('input', 'player-volume-slider');
      Object.assign(slider, { type: 'range', min: '0', max: '100', step: '1' });
      slider.setAttribute('aria-label', 'Volume');
      const level = el('span', 'player-volume-level');
      level.setAttribute('aria-hidden', 'true');
      const paintVolume = () => {
        const percent = Math.round(vid.volume * 100) + '%';
        slider.value = Math.round(vid.volume * 100);
        level.textContent = percent;
      };
      slider.addEventListener('input', () => {
        vid.volume = slider.valueAsNumber / 100;
        localStorage.setItem('player_volume', slider.value);
      });
      vid.addEventListener('volumechange', paintVolume);
      paintVolume();
      volumePanel.append(slider, level);
    } else {
      const hint = el('span');
      hint.textContent = 'Use your device’s volume buttons.';
      const mute = el('button', 'player-volume-button');
      mute.type = 'button';
      mute.textContent = 'Mute';
      mute.setAttribute('aria-pressed', 'false');
      stylePlayerButton(mute);
      mute.onclick = () => { vid.muted = !vid.muted; };
      vid.addEventListener('volumechange', () => mute.setAttribute('aria-pressed', String(vid.muted)));
      volumePanel.append(hint, mute);
    }
    volume.addEventListener('dblclick', e => e.stopPropagation());
    const label = q => q === 'auto' ? 'Auto' : q + 'p';
    let heights = v.demo ? [360] : null, audio = [], defaultAudio = '';
    let hasHls = true;
    const loadHeights = () => P.__heights || (P.__heights = fetch('/api/qualities?id=' + v.id + (v.live ? '&live=1' : ''))
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}))
      .then(r => {
        audio = r.audio || [];
        defaultAudio = r.defaultAudio || '';
        heights = (r.heights || []).filter(h => h >= 144).sort((a, b) => b - a);
        hasHls = heights.length > 0;
        if (!hasHls) heights = [360];
        return heights;
      }));
    const saved = localStorage.quality ? (localStorage.quality === 'auto' ? 'auto' : +localStorage.quality) : (localStorage.default_hq === '1' ? 'auto' : 360);
    let q = v.live && saved === 360 ? 'auto' : saved;
    const hqOn = () => q === 'auto' || q > 480;
    P.__rate = +localStorage.speed || 1;
    const show_ = () => { qLabel.textContent = label(q) + (P.__rate !== 1 ? ' · ' + P.__rate + 'x' : ''); hq.style.backgroundImage = `url(apps/v22/res/drawable-hdpi-v4/btn_hq_${hqOn() ? 'on' : 'off'}.png)`; };
    let active, pendingPlayback, requested = 0, disposed = false;
    P.__cancelSource = () => {};
    P.__disposeSource = () => { disposed = true; P.__cancelSource(); };
    const selectSource = async (quality, { track, save = false } = {}) => {
      const request = ++requested;
      if (!v.live && !v.demo && !heights) await loadHeights();
      if (disposed || request !== requested) return;
      if (!v.live && active?.progressive && !track) {
        if (quality !== 360) toast('This quality is unavailable with the current audio track');
        return;
      }
      const progressive = v.demo || (!v.live && !hasHls);
      if (progressive) quality = 360;
      else if (!v.live && quality !== 'auto' && !heights.includes(quality)) quality = heights.find(h => h <= quality) || heights.at(-1);
      const source = { quality, track: track || active?.track || defaultAudio, progressive };
      const playback = pendingPlayback ||= { time: vid.currentTime || 0, paused: !!active && vid.paused };
      const start = (next, onError, remember = false) => {
        q = next.quality;
        show_();
        attachSource(P, vid, v, next, playback, () => {
          active = next;
          pendingPlayback = null;
          if (remember) localStorage.quality = String(q);
        }, onError);
      };
      const unavailable = () => {
        pendingPlayback = null;
        toast(v.live ? 'Live stream unavailable' : 'Video unavailable');
      };
      start(source, () => {
        if (active && active !== source) {
          toast('This option is unavailable with the current video');
          start(active, unavailable);
        } else if (!active && !v.live && !progressive) {
          const fallback = { quality: 360, track: '', progressive: true };
          if (source.quality !== 360 && heights.includes(360)) {
            const lower = { ...source, quality: 360 };
            start(lower, () => active === lower ? unavailable() : start(fallback, unavailable));
          } else start(fallback, unavailable);
        } else unavailable();
      }, save);
    };
    const setQuality = quality => selectSource(quality, { save: true });
    selectSource(q);
    show_();
    // Menu: Quality / Playback speed / Audio track (the last only when the video has more than one)
    const pickList = (title, opts, cur, onPick) => {
      const list = el('div');
      for (const [val, text] of opts) {
        const it = el('div', '', { padding: '12px 4px', fontSize: '17px', borderBottom: '1px solid #444', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '8px' });
        const a1 = el('span'); a1.textContent = text; const a2 = el('span', '', { color: '#33b5e5' }); a2.textContent = val === cur ? '✓' : '';
        it.append(a1, a2); it.onclick = () => { closeDialogs(); if (val !== cur) onPick(val); }; list.appendChild(it);
      }
      dialog(title, list, [['Cancel', closeDialogs]]);
    };
    const audioName = id => { const t = audio.find(x => x.id === id); return t ? t.name : 'Default'; };
    const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const openQuality = async () => { const hs = heights || await loadHeights(); pickList('Video quality', [['auto', 'Auto'], ...hs.map(x => [x, x + 'p' + (x >= 720 ? ' HD' : '')])], q, setQuality); };
    const openSpeed = () => pickList('Playback speed', SPEEDS.map(x => [x, x === 1 ? 'Normal' : x + 'x']), P.__rate, r => { P.__rate = r; localStorage.speed = r; vid.defaultPlaybackRate = vid.playbackRate = r; show_(); });
    const currentTrack = () => active?.progressive ? '' : active?.track || defaultAudio || audio.find(t => t.def)?.id || '';
    const openAudio = () => pickList('Audio track', audio.map(t => [t.id, t.name]), currentTrack(), id => selectSource(q, { track: id }));
    qBtn.onclick = async e => {
      e.stopPropagation();
      const list = el('div'); const wait_ = el('div', '', { padding: '14px 4px', color: '#aaa', fontSize: '15px' }); wait_.textContent = 'Loading…'; list.appendChild(wait_);
      const dlg = dialog('Options', list, [['Cancel', closeDialogs]]);
      if (!heights) await loadHeights(); if (!document.body.contains(dlg)) return;
      list.replaceChildren();
      const row = (title, value, fn) => { const it = el('div', '', { padding: '10px 4px', borderBottom: '1px solid #444', cursor: 'pointer' }); const t1 = el('div', '', { fontSize: '18px' }); t1.textContent = title; const t2 = el('div', '', { fontSize: '14px', color: '#bbb' }); t2.textContent = value; it.append(t1, t2); it.onclick = () => { closeDialogs(); fn(); }; list.appendChild(it); };
      row('Quality', label(q), openQuality);
      row('Playback speed', P.__rate === 1 ? 'Normal' : P.__rate + 'x', openSpeed);
      if (audio.length > 1) row('Audio track', audioName(currentTrack()), openAudio);
    };
    // the original top-right HQ button stays as a quick switch: HQ on = Auto (best), HQ off = 360p
    hq.onclick = e => { e.stopPropagation(); setQuality(hqOn() ? 360 : 'auto'); };
    const toggleFs = () => { if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else if (P.requestFullscreen) P.requestFullscreen().then(() => window.screen.orientation && window.screen.orientation.lock && window.screen.orientation.lock('landscape').catch(() => {})).catch(() => vid.webkitEnterFullscreen && vid.webkitEnterFullscreen()); else if (P.webkitRequestFullscreen) P.webkitRequestFullscreen(); else if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen(); };
    fs.onclick = e => { e.stopPropagation(); toggleFs(); };
    P.addEventListener('dblclick', e => { e.preventDefault(); toggleFs(); });
    // Live chat over the video in fullscreen (not on iOS, which uses its own fullscreen player). Closing it lasts until the
    // next time fullscreen is entered; the "Chat" button in the controls brings it back.
    const chatFs = el('div', 'chat-fs', { position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(360px, 38%)', background: 'rgba(0,0,0,.6)', display: 'none', flexDirection: 'column', zIndex: 4, borderLeft: '1px solid rgba(255,255,255,.15)' });
    const chatFsHead = el('div', '', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'linear-gradient(#555,#222)', fontSize: '14px', color: '#fff' });
    const chatFsTitle = el('span'); const chatFsX = el('span', '', { cursor: 'pointer', fontSize: '18px', padding: '0 4px' }); chatFsX.textContent = '✕';
    chatFsHead.append(chatFsTitle, chatFsX); chatFs.appendChild(chatFsHead); P.appendChild(chatFs);
    ['click', 'dblclick', 'pointerdown'].forEach(ev => chatFs.addEventListener(ev, e => e.stopPropagation()));
    const chatBtn = el('div', '', { position: 'absolute', right: '8px', top: '50px', padding: '4px 8px', fontSize: '12px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.6)', border: '1px solid #777', borderRadius: '3px', cursor: 'pointer', display: 'none' });
    chatBtn.textContent = 'Chat'; hud.appendChild(chatBtn);
    let chatClosed = false, chatHome = null;
    const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const layoutChat = () => {
      const c = P.__chat, on = fsOn() && c && !isApple;
      if (on && !chatClosed) { if (!chatHome) { chatHome = document.createComment('chat'); c.el.parentNode && c.el.parentNode.insertBefore(chatHome, c.el); } chatFsTitle.textContent = c.title; chatFs.appendChild(c.el); chatFs.style.display = 'flex'; c.el.style.flex = '1 1 0'; c.scrollEnd(); }
      else { chatFs.style.display = 'none'; if (chatHome && c) { chatHome.parentNode.insertBefore(c.el, chatHome); chatHome.remove(); chatHome = null; c.el.style.flex = ''; c.scrollEnd(); } }
      chatBtn.style.display = on && chatClosed ? 'block' : 'none';
    };
    chatFsX.onclick = () => { chatClosed = true; layoutChat(); };
    chatBtn.onclick = e => { e.stopPropagation(); chatClosed = false; layoutChat(); };
    P.__layoutChat = layoutChat;
    const onFs = () => { const on = fsOn(); fs.style.backgroundImage = `url(apps/v22/res/drawable-hdpi-v4/ic_vidcontrol_fullscreen${on ? 'on' : 'off'}.png)`; P.style.aspectRatio = on ? 'auto' : '16/9'; if (on) chatClosed = false; layoutChat(); };
    document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
    // buffering spinner
    const spin = el('div', 'spinner', { position: 'absolute', left: '50%', top: '50%', width: '36px', height: '36px', margin: '-18px 0 0 -18px', display: 'none', pointerEvents: 'none', borderColor: 'rgba(255,255,255,.25)', borderTopColor: '#fff' }); P.appendChild(spin);
    vid.addEventListener('waiting', () => { spin.style.display = 'block'; }); ['playing', 'canplay', 'pause'].forEach(ev => vid.addEventListener(ev, () => { spin.style.display = 'none'; }));
    let hideT; const show = () => { hud.style.opacity = 1; hud.style.pointerEvents = 'auto'; clearTimeout(hideT); if (!vid.paused && !volume.open) hideT = setTimeout(() => { hud.style.opacity = 0; hud.style.pointerEvents = 'none'; }, 3000); };
    volume.addEventListener('focusin', show);
    volume.addEventListener('toggle', show);
    volume.addEventListener('keydown', e => {
      if (e.key === 'Escape' && volume.open) {
        e.preventDefault();
        volume.open = false;
        volumeToggle.focus();
      }
    });
    P.addEventListener('click', e => {
      if (volume.open && !volume.contains(e.target)) volume.open = false;
    }, true);
    const toggle = () => { vid.paused || vid.ended ? vid.play().catch(() => {}) : vid.pause(); };
    center.onclick = e => { e.stopPropagation(); toggle(); };
    P.addEventListener('click', e => { if (hud.style.opacity === '0') show(); else if (e.target === vid || e.target === hud || e.target === shade) { hud.style.opacity = hud.style.opacity === '0' ? 1 : 0; hud.style.pointerEvents = hud.style.opacity === '0' ? 'none' : 'auto'; } });
    vid.addEventListener('play', () => { setGlyph(true); show(); }); vid.addEventListener('pause', () => { setGlyph(false); show(); });
    vid.addEventListener('ended', () => { setGlyph(false); show(); });
    const paintF = f => { prog.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%'; };
    let drag = false, dragF = 0;
    vid.addEventListener('timeupdate', () => {
      const r = rng(), f = r[1] > r[0] ? (vid.currentTime - r[0]) / (r[1] - r[0]) : 1;
      if (!drag) paintF(Math.min(1, Math.max(0, f)));
      tcur.textContent = fmtTime(vid.currentTime);
      if (liveBadge) { const live = atLive(); liveBadge.style.background = live ? '#cc0000' : '#555'; ttot.textContent = live ? '' : '-' + fmtTime(r[1] - vid.currentTime); }
    });
    if (!v.live) vid.addEventListener('loadedmetadata', () => { ttot.textContent = fmtTime(vid.duration); });
    // Scrubbing: the knob follows the finger, a bubble above it shows the target time, the seek happens on release.
    const bubble = el('div', '', { position: 'absolute', bottom: '56px', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.85)', color: '#fff', fontSize: '13px', fontWeight: 700, padding: '3px 8px', borderRadius: '3px', border: '1px solid #666', display: 'none', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 3 });
    bar.appendChild(bubble);
    const durNow = () => vid.duration && isFinite(vid.duration) ? vid.duration : (v.dur || 1);
    // [start, end] of what can be played: the whole video, or the rewind window of a live stream
    const rng = () => { if (v.live) { const s = vid.seekable; if (s && s.length) return [s.start(0), s.end(s.length - 1)]; return [0, Math.max(1, vid.currentTime)]; } return [0, durNow()]; };
    const atLive = () => { const r = rng(); return r[1] - vid.currentTime < 25; };
    const fAt = e => { const r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    const showBubble = f => { const r = rng(); bubble.style.display = 'block'; bubble.style.left = f * 100 + '%'; const t = r[0] + f * (r[1] - r[0]); bubble.textContent = v.live ? (r[1] - t < 25 ? 'LIVE' : '-' + fmtTime(r[1] - t)) : fmtTime(t); };
    bar.addEventListener('pointerdown', e => { e.stopPropagation(); drag = true; bar.setPointerCapture(e.pointerId); dragF = fAt(e); paintF(dragF); showBubble(dragF); clearTimeout(hideT); hud.style.opacity = 1; });
    bar.addEventListener('pointermove', e => { if (drag) { dragF = fAt(e); paintF(dragF); showBubble(dragF); } else if (e.pointerType === 'mouse') showBubble(fAt(e)); });
    const endDrag = () => { if (!drag) return; drag = false; bubble.style.display = 'none'; const r = rng(); vid.currentTime = r[0] + dragF * (r[1] - r[0]); show(); };
    bar.addEventListener('pointerup', endDrag); bar.addEventListener('pointercancel', endDrag);
    bar.addEventListener('pointerleave', () => { if (!drag) bubble.style.display = 'none'; });
    bar.addEventListener('click', e => e.stopPropagation());
    prog.style.top = '18px'; prog.style.bottom = '18px'; knob.style.top = '-12px'; shade.style.pointerEvents = 'none';
    const track = el('div', '', { position: 'absolute', left: 0, right: 0, top: '18px', height: '4px', background: '#212121' }); bar.insertBefore(track, prog);
    prog.style.height = '4px'; prog.style.bottom = 'auto';
    setGlyph(false);
    return P;
  }

  // ---- dialogs / overlays ----
  let overlay = null;
  function closeDialogs() { if (overlay) { overlay.remove(); overlay = null; } }
  const closeMenu = () => closeDialogs(), closeSearch = () => closeDialogs();
  function toast(msg) {
    const t = el('div', '', { position: 'absolute', left: '50%', bottom: '60px', transform: 'translateX(-50%)', background: 'rgba(30,30,30,.92)', color: '#fff', fontSize: '14px', padding: '10px 16px', borderRadius: '8px', zIndex: 50, border: '1px solid #555', maxWidth: '80%', textAlign: 'center' });
    t.textContent = msg; app.appendChild(t); setTimeout(() => t.remove(), 2200);
  }
  function overlayBase(dim) { closeDialogs(); overlay = el('div', 'overlay', { position: 'absolute', inset: '0', zIndex: 40, background: dim || 'rgba(0,0,0,.5)' }); overlay.addEventListener('click', e => { if (e.target === overlay) closeDialogs(); }); app.appendChild(overlay); return overlay; }
  // Froyo-style options menu (icon grid pinned to the bottom)
  async function toggleMenu() {
    if (overlay && overlay.dataset.kind === 'menu') return closeDialogs();
    const o = overlayBase('rgba(0,0,0,.4)'); o.dataset.kind = 'menu';
    const grid = el('div', '', { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'linear-gradient(#2b2b2b,#000)', borderTop: '1px solid #666', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '2px' });
    const items = [['menu_home', 'ic_menu_home', () => go('home')], ['menu_browse', 'ic_menu_browse', () => go('categories')], ['menu_search', 'ic_menu_search_normal', () => { closeDialogs(); openSearch(); }],
      ['menu_my_channel', 'ic_menu_my_channel', () => go('mychannel')], ['menu_settings', null, () => go('settings')]];
    for (const [t, ic, fn] of items) {
      const b = el('div', '', { height: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', cursor: 'pointer' });
      const i = el('div', '', { width: '32px', height: '32px', background: ic ? `url(apps/v22/res/drawable-hdpi-v4/${ic}.png) center/100% 100% no-repeat` : '', }); if (!ic) i.style.backgroundImage = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23ddd' d='M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.5-2.5 1a7 7 0 00-1.7-1L15 3.3h-4l-.4 2.6a7 7 0 00-1.7 1l-2.5-1-2 3.5L6.6 11a7.500 7.500 0 000 2l-2.100 1.600 2 3.500 2.500-1a7 7 0 001.700 1l.4 2.600h4l.4-2.600a7 7 0 001.700-1l2.500 1 2-3.500zM12 15.500a3.500 3.500 0 110-7 3.500 3.500 0 010 7z'/></svg>")`;
      b.appendChild(i); b.appendChild(document.createTextNode(S(t))); b.onclick = fn; grid.appendChild(b);
    }
    o.appendChild(grid);
  }
  function openSearch() {
    const o = overlayBase('rgba(0,0,0,.5)'); o.dataset.kind = 'search';
    const bar = el('div', '', { position: 'absolute', left: 0, right: 0, top: 0, background: '#222', padding: '6px', display: 'flex', gap: '6px', borderBottom: '1px solid #555' });
    const inp = el('input', '', { flex: '1', fontSize: '16px', padding: '9px', border: '1px solid #888', borderRadius: '4px', background: '#fff', color: '#000', fontFamily: 'inherit', outline: 'none' }); inp.placeholder = S('search_hint'); inp.type = 'search';
    const go_ = el('div', '', { width: '44px', background: `#444 url(apps/v22/res/drawable-hdpi-v4/ic_menu_search_normal.png) center/28px no-repeat`, borderRadius: '4px', cursor: 'pointer' });
    const submit = () => { const q = inp.value.trim(); if (q) go('results', { q }); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }); go_.onclick = submit;
    bar.append(inp, go_); o.appendChild(bar); setTimeout(() => inp.focus(), 50);
  }
  async function openToolbar(v) {
    const o = overlayBase('rgba(0,0,0,.35)'); o.dataset.kind = 'toolbar';
    const box = el('div', '', { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,.76)', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', padding: '6px 0' });
    const items = [['like_drawable', 'Like', 'You like this video'], ['dislike_drawable', 'Dislike', 'You dislike this video'], ['favorite_drawable', S('add_favorite'), S('add_favorite_done')], ['save_drawable', S('save_to_playlist'), 'Playlists are not available in this demo'],
      ['share_drawable', S('share'), 'Share: ' + location.origin + '/?watch=' + v.id], ['copy_url_drawable', S('copy_url_button_text'), 'URL copied'], ['flag_drawable', S('flag'), 'Video flagged']];
    for (const [dr, label, msg] of items) {
      const d = await RT.drawable('@drawable/' + dr); const t = await V.inflate('toolbar_item', null); t.style.height = '64px';
      const p = RT.pick(d, {}); const ic = V.find(t, 'icon'); const set = st => { const q = RT.pick(d, st); ic.__img.style.backgroundImage = `url(${q.url})`; ic.__img.style.backgroundSize = q.w + 'px ' + q.h + 'px'; ic.style.width = q.w + 'px'; ic.style.height = q.h + 'px'; };
      set({}); V.find(t, 'text').querySelector('.t').textContent = label; t.style.cursor = 'pointer';
      t.addEventListener('pointerdown', () => set({ pressed: true })); ['pointerup', 'pointerleave'].forEach(e => t.addEventListener(e, () => set({})));
      t.onclick = () => { closeDialogs(); toast(msg); }; t.style.width = 'auto'; t.style.flex = 'none'; box.appendChild(t);
    }
    o.appendChild(box); V.layoutTree(box);
  }
  function commentDialog(list, v) {
    const o = overlayBase('rgba(0,0,0,.6)');
    const box = el('div', '', { position: 'absolute', left: '10px', right: '10px', top: '60px', background: '#222', border: '1px solid #666', borderRadius: '6px', padding: '10px' });
    const t = el('div', '', { fontSize: '18px', marginBottom: '8px' }); t.textContent = S('comment_dialog_title');
    const ta = el('textarea', '', { width: '100%', height: '90px', fontSize: '14px', fontFamily: 'inherit', padding: '6px' }); ta.placeholder = S('comment_hint'); ta.maxLength = 10000;
    const b = el('div', '', { marginTop: '8px', textAlign: 'center', padding: '10px', border: '1px solid #555', borderRadius: '4px', background: 'linear-gradient(#444,#222)', cursor: 'pointer' }); b.textContent = S('comment_post_button');
    let busy = false;
    b.onclick = async () => {
      const text = ta.value.trim(); if (!text || busy) return;
      if (v.demo) return toast('Demo video: comments are not sent');
      busy = true; b.textContent = '…';
      try {
        const c = await API.addComment(v.id, text);
        closeDialogs(); toast(S('comment_done'));
        const it = await V.inflate('comment_item', null); V.find(it, 'author').querySelector('.t').textContent = c.author; V.find(it, 'comment').querySelector('.t').textContent = c.text; V.find(it, 'time').querySelector('.t').textContent = c.time;
        list.insertBefore(it, list.children[1] || null); V.layoutTree(it);
      } catch (e) { busy = false; b.textContent = S('comment_post_button'); toast(e.status === 401 ? 'Sign in (Settings → Google account) to comment' : 'Comment not posted: ' + e.message); }
    };
    box.append(t, ta, b); o.appendChild(box); ta.focus();
  }

  // ---- live chat / chat replay ----
  function makeChat(v, vid) {
    const replay = v.chat.replay, title = replay ? 'Chat replay' : 'Live chat';
    const box = el('div', 'chat', { display: 'flex', flexDirection: 'column', minHeight: '0', background: '#000' });
    const list = el('div', '', { flex: '1 1 0', minHeight: '0', overflowY: 'auto', padding: '4px 6px', fontSize: '13px', lineHeight: 1.3 });
    box.appendChild(list);
    const note = el('div', '', { color: '#888', padding: '6px 0', textAlign: 'center' }); note.textContent = 'Loading chat…'; list.appendChild(note);
    if (!replay) {
      const row = el('div', '', { display: 'flex', gap: '4px', padding: '4px', borderTop: '1px solid #333', background: '#111' });
      const inp = el('input', '', { flex: '1', minWidth: '0', fontSize: '14px', padding: '7px', border: '1px solid #666', borderRadius: '3px', background: '#fff', color: '#000', fontFamily: 'inherit' }); inp.placeholder = 'Say something…'; inp.maxLength = 200;
      const send = el('div', '', { padding: '0 12px', display: 'flex', alignItems: 'center', border: '1px solid #555', borderRadius: '3px', background: 'linear-gradient(#444,#222)', color: '#fff', fontSize: '13px', cursor: 'pointer' }); send.textContent = 'Send';
      // no local copy: the message comes back from YouTube with the public @handle on the next chat update
      let busy = false, resetT;
      const go_ = async () => {
        const t = inp.value.trim(); if (!t || busy) return; busy = true; clearTimeout(resetT); send.textContent = '…';
        try { await API.sendChat(v.id, t); inp.value = ''; send.textContent = 'Sent'; send.style.color = '#8bc34a'; }
        catch (e) { send.textContent = 'Send'; toast(e.status === 401 ? e.message : 'Message not sent: ' + e.message); }
        busy = false; resetT = setTimeout(() => { send.textContent = 'Send'; send.style.color = '#fff'; }, 2000);
      };
      send.onclick = go_; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go_(); });
      row.append(inp, send); box.appendChild(row);
    }
    const nearEnd = () => list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const scrollEnd = () => { list.scrollTop = list.scrollHeight; };
    const seen = new Set();
    function add(items) {
      if (!items.length) return; const stick = nearEnd(); if (note.isConnected) note.remove();
      for (const m of items) {
        if (m.id && seen.has(m.id)) continue; if (m.id) seen.add(m.id);
        const line = el('div', '', { padding: '2px 0', wordBreak: 'break-word', color: '#fff' });
        if (m.paid) { line.style.background = 'rgba(221,0,0,.35)'; line.style.padding = '3px 4px'; }
        const au = el('span', '', { fontWeight: 700, color: m.owner ? '#ffd600' : m.mod ? '#7fa6ff' : '#aaa', marginRight: '5px' }); au.textContent = m.author + (m.paid ? ' ' + m.paid : '');
        const tx = el('span'); tx.textContent = m.text; line.append(au, tx); list.appendChild(line);
      }
      while (list.children.length > 250) list.firstChild.remove();   // keep the chat light
      if (stick) scrollEnd();
    }
    let stopped = false, timer = null;
    const sleep = ms => new Promise(r => { timer = setTimeout(r, ms); });
    async function liveLoop() {
      let tok = v.chat.token;
      while (!stopped && tok) {
        try { const r = await API.chat(tok); add(r.items); tok = r.next; await sleep(Math.min(10000, Math.max(1500, r.timeoutMs || 5000))); }
        catch (e) { await sleep(8000); }
      }
      if (!stopped) note.textContent = 'Chat has ended';
    }
    // replay: messages carry their video offset; fetch ahead of the playhead, show what is due, restart after a seek
    async function replayLoop() {
      let buf = [], cont = null, fetchedTo = -1, last = -1, busy = false;
      const fetchAt = async (tok, ms) => { busy = true; try { const r = await API.chat(tok, ms); buf.push(...r.items); cont = r.next; fetchedTo = r.items.length ? Math.max(fetchedTo, r.items[r.items.length - 1].ms) : ms + 30000; } catch (e) {} busy = false; };
      while (!stopped) {
        const t = (vid.currentTime || 0) * 1000;
        if (last >= 0 && Math.abs(t - last) > 15000) { buf = []; cont = null; fetchedTo = -1; list.replaceChildren(); seen.clear(); }
        last = t;
        if (!busy && fetchedTo < t + 10000) fetchAt(cont || v.chat.token, t);
        const due = buf.filter(m => m.ms <= t); if (due.length) { buf = buf.filter(m => m.ms > t); add(due); }
        await sleep(500);
      }
    }
    return { el: box, title, scrollEnd, start() { (replay ? replayLoop : liveLoop)(); }, stop() { stopped = true; clearTimeout(timer); } };
  }

  // ---- dialogs in the Froyo style ----
  function dialog(title, bodyEl, buttons) {
    const o = overlayBase('rgba(0,0,0,.6)'); o.dataset.kind = 'dialog';
    const box = el('div', '', { position: 'absolute', left: '12px', right: '12px', top: '50%', transform: 'translateY(-50%)', background: '#2b2b2b', border: '1px solid #777', borderRadius: '6px', overflow: 'hidden', maxHeight: '86%', display: 'flex', flexDirection: 'column' });
    const t = el('div', '', { fontSize: '20px', padding: '10px 14px', borderBottom: '2px solid #33b5e5' }); t.textContent = title;
    const body = el('div', '', { padding: '12px 14px', fontSize: '15px', overflowY: 'auto' }); body.appendChild(bodyEl);
    box.append(t, body);
    if (buttons && buttons.length) { const row = el('div', '', { display: 'flex', gap: '1px', background: '#555', borderTop: '1px solid #555' }); for (const [label, fn] of buttons) { const b = el('div', '', { flex: '1', textAlign: 'center', padding: '12px', background: '#3a3a3a', cursor: 'pointer', fontSize: '16px' }); b.textContent = label; b.onclick = () => fn(); row.appendChild(b); } box.appendChild(row); }
    o.appendChild(box); return o;
  }
  const para = t => { const d = el('div', '', { lineHeight: 1.35 }); d.textContent = t; return d; };
  async function arrayOf(name) { const d = await RT.xml('values/arrays.xml'); const n = [...d.documentElement.children].find(c => c.getAttribute('name') === name); return n ? [...n.children].map(c => RT.ref(c.textContent.trim())) : []; }

  // ---- Google account ----
  // One "Google account" entry with two ways to sign in:
  //  1. a code at google.com/device (TV sign-in): recommendations, comments, liked videos, subscriptions
  //  2. youtube.com cookies: all of the above plus writing in live chat
  async function accountDialog() {
    const st = await API.authStatus();
    if (st.signedIn) {
      const p = st.profile || {};
      const b = el('div'); b.appendChild(para((p.name || 'Signed in') + (p.handle ? '  ' + p.handle : '')));
      const m = para(p.method === 'cookies' ? 'Signed in with youtube.com cookies.' : 'Signed in with a code (TV sign-in). Live chat needs cookies; you can add them below.'); m.style.color = '#aaa'; m.style.marginTop = '6px'; b.appendChild(m);
      const btns = [['Sign out', async () => { await API.authLogout(); closeDialogs(); toast('Signed out'); go('settings', {}, true); }]];
      if (p.method !== 'cookies') btns.push(['Add cookies', () => { closeDialogs(); cookiesDialog(); }]);
      btns.push(['Close', closeDialogs]);
      return dialog('Google account', b, btns);
    }
    const b = el('div');
    const opt = (title, sub, fn) => { const it = el('div', '', { padding: '12px 4px', borderBottom: '1px solid #444', cursor: 'pointer' }); const t1 = el('div', '', { fontSize: '18px' }); t1.textContent = title; const t2 = el('div', '', { fontSize: '13px', color: '#aaa' }); t2.textContent = sub; it.append(t1, t2); it.onclick = () => { closeDialogs(); fn(); }; b.appendChild(it); };
    opt('Sign in with a code', 'Enter a code at google.com/device. Recommendations, comments, your channel. No live chat.', codeSignIn);
    opt('Sign in with youtube.com cookies', 'Everything, including writing in live chat. Cookies give full access to the account.', cookiesDialog);
    dialog('Sign in', b, [['Cancel', closeDialogs]]);
  }
  async function codeSignIn() {
    let timer;
    const body = el('div'); body.appendChild(para('Open google.com/device on any device and enter this code.'));
    const code = el('div', '', { fontSize: '30px', letterSpacing: '3px', textAlign: 'center', margin: '14px 0', fontWeight: 700, color: '#33b5e5' }); body.appendChild(code);
    const info = el('div', '', { fontSize: '13px', color: '#aaa', textAlign: 'center' }); body.appendChild(info);
    const o = dialog('Sign in with a code', body, [['Open google.com/device', () => window.open('https://www.google.com/device', '_blank')], ['Cancel', () => { clearInterval(timer); closeDialogs(); }]]);
    try {
      const s = await API.authStart(); code.textContent = s.user_code; info.textContent = 'Waiting for confirmation…';
      timer = setInterval(async () => {
        if (!document.body.contains(o)) return clearInterval(timer);
        const r = await API.authPoll().catch(() => ({ status: 'pending' }));
        if (r.status === 'ok') { clearInterval(timer); closeDialogs(); toast('Signed in'); go('home', {}, true); }
        else if (r.status === 'expired' || r.status === 'error') { clearInterval(timer); info.textContent = 'The code expired. Close and try again.'; }
      }, Math.max(3000, (s.interval || 5) * 1000));
    } catch (e) { info.textContent = 'Sign-in is not available: ' + e.message; }
  }

  // youtube.com cookies: the only way to send live chat messages (the TV sign-in is refused by YouTube for chat)
  async function cookiesDialog() {
    const cs = await API.cookieStatus();
    const body = el('div');
    const p1 = para('Sign in with the cookies of a signed-in youtube.com. On a computer: open youtube.com signed in, export the cookies with the "Get cookies.txt LOCALLY" extension (or copy the Cookie request header from the developer tools) and paste them here.');
    const p2 = para('Warning: cookies give full access to the Google account. They stay on this server in data/cookies.txt. Use a separate account if you can.'); p2.style.color = '#ffb74d'; p2.style.marginTop = '8px';
    const ta = el('textarea', '', { width: '100%', height: '110px', fontSize: '12px', fontFamily: 'monospace', padding: '6px', marginTop: '10px' }); ta.placeholder = cs.set ? 'Paste new cookies to replace the saved ones' : 'Paste cookies here';
    const info = el('div', '', { fontSize: '13px', color: '#aaa', marginTop: '6px' }); info.textContent = cs.set ? (cs.ok ? 'Saved: ' + cs.name : 'Saved cookies do not work: ' + (cs.error || '')) : 'No cookies saved';
    body.append(p1, p2, ta, info);
    const buttons = [['Save', async () => { if (!ta.value.trim()) return; info.textContent = 'Checking…'; try { const r = await API.setCookies(ta.value); closeDialogs(); toast('Signed in as ' + r.name); go('home', {}, true); } catch (e) { info.textContent = e.message; } }]];
    if (cs.set) buttons.push(['Remove', async () => { await API.clearCookies(); closeDialogs(); toast('Cookies removed'); go('settings', {}, true); }]);
    buttons.push(['Cancel', closeDialogs]);
    dialog('Sign in with cookies', body, buttons);
  }

  routes.settings = async () => {
    const root = el('div', '', { display: 'flex', flexDirection: 'column', background: '#000' });
    const hh = await V.inflate('header', null); hh.style.width = '100%'; await header(hh, { buttons: [] }); root.appendChild(hh);
    const list = el('div', '', { flex: '1', overflowY: 'auto' }); root.appendChild(list);
    const doc = await RT.xml('xml/youtube_preferences.xml'); const A = RT.A;
    const st = await API.authStatus();
    const cat = t => { const c = el('div', '', { background: 'linear-gradient(#555,#222)', color: '#fff', fontSize: '14px', padding: '2px 8px', borderBottom: '1px solid #000' }); c.textContent = RT.ref(t); return c; };
    const row = (title, summary, onClick, ctl) => {
      const r = el('div', '', { padding: '10px 12px', minHeight: '64px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', cursor: onClick ? 'pointer' : 'default' });
      const txt = el('div', '', { flex: '1' }); const t1 = el('div', '', { fontSize: '18px' }); t1.textContent = title; const t2 = el('div', '', { fontSize: '14px', color: '#bbb' }); t2.textContent = summary || ''; txt.append(t1, t2); r.appendChild(txt);
      if (ctl) r.appendChild(ctl);
      if (onClick) { r.onclick = onClick; r.addEventListener('pointerdown', () => r.style.background = 'linear-gradient(#ffd27a,#ffa40c)'); ['pointerup', 'pointerleave'].forEach(e => r.addEventListener(e, () => r.style.background = '')); }
      return r;
    };
    const LINKS = { help: 'https://support.google.com/youtube', mobile_terms: 'https://www.google.com/mobile/terms.html', youtube_terms: 'https://www.youtube.com/t/terms', mobile_privacy: 'https://www.google.com/mobile/privacy.html', youtube_privacy: 'https://www.youtube.com/t/privacy' };
    const VERSION = '2.2.14 — a port of the YouTube Android app to the browser: smartphone mode, made to work on iOS (Safari) and Android.';
    for (const c of doc.documentElement.children) {
      list.appendChild(cat(A(c, 'title')));
      if (A(c, 'title') === '@string/pref_general_category') {
        list.appendChild(row('Google account', st.signedIn ? ((st.profile && st.profile.name) || 'Signed in') + (st.method === 'cookies' ? ' (cookies)' : ' (code)') : 'Sign in with a code or with youtube.com cookies', accountDialog));
      }
      for (const p of c.children) {
        const key = A(p, 'key'); if (key === 'upload_policy') continue;   // uploading is not part of this port
        const title = RT.ref(A(p, 'title')), summary = RT.ref(A(p, 'summary') || '');
        if (p.tagName === 'CheckBoxPreference') {
          const cb = el('div', '', { width: '32px', height: '32px', border: '2px solid #aaa', borderRadius: '4px', marginLeft: '8px', background: localStorage[key] === '1' ? '#8bc34a' : '#000' });
          list.appendChild(row(title, summary, () => { localStorage[key] = localStorage[key] === '1' ? '0' : '1'; cb.style.background = localStorage[key] === '1' ? '#8bc34a' : '#000'; }, cb));
        } else if (p.tagName === 'ListPreference') {
          const labels = await arrayOf(A(p, 'entries').replace('@array/', '')), vals = await arrayOf(A(p, 'entryValues').replace('@array/', ''));
          list.appendChild(row(title, summary, () => { const b = el('div'); labels.forEach((l, i) => { const it = el('div', '', { padding: '12px 4px', fontSize: '17px', borderBottom: '1px solid #444', cursor: 'pointer' }); it.textContent = l + (localStorage[key] === vals[i] ? '  ✓' : ''); it.onclick = () => { localStorage[key] = vals[i]; closeDialogs(); }; b.appendChild(it); }); dialog(title, b, [['Cancel', closeDialogs]]); }));
        } else if (key === 'version') {
          list.appendChild(row(title, VERSION, null));
        } else if (LINKS[key]) {
          list.appendChild(row(title, summary, () => window.open(LINKS[key], '_blank')));
        } else if (key === 'clear_history') {
          list.appendChild(row(title, summary, () => { localStorage.removeItem('search_history'); toast('Search history cleared'); }));
        } else if (key === 'safe_search') {
          const lv = ['Off', 'Moderate', 'Strict'];
          list.appendChild(row(title, summary, () => { const b = el('div'); lv.forEach((l, i) => { const it = el('div', '', { padding: '12px 4px', fontSize: '17px', borderBottom: '1px solid #444', cursor: 'pointer' }); it.textContent = l + ((localStorage.safe_search || '1') === String(i) ? '  ✓' : ''); it.onclick = () => { localStorage.safe_search = i; closeDialogs(); }; b.appendChild(it); }); dialog(S('safe_search_dialog_title'), b, [['Cancel', closeDialogs]]); }));
        } else if (key === 'feedback') {
          list.appendChild(row(title, summary, () => toast('Feedback is not available in this port')));
        } else list.appendChild(row(title, summary, () => toast(title)));
      }
    }
    return root;
  };

  // boot (supports deep link ?watch=ID)
  const deep = new URLSearchParams(location.search).get('watch');
  const gq = new URLSearchParams(location.search).get('go');
  const first = history.state || (gq ? { name: gq.split(':')[0], arg: gq.includes(':') ? { q: gq.split(':')[1], category: gq.split(':')[1], who: gq.split(':')[1] } : {} } : (deep ? { name: 'watch', arg: { id: deep } } : { name: 'home' }));
  history.replaceState(first, ''); await render(first);
})().catch(e => { document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f55;position:fixed;top:0;background:#000;padding:8px;z-index:99;white-space:pre-wrap;font-size:11px">' + (e.stack || e) + '</pre>'); });
