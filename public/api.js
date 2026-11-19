// SPDX-License-Identifier: GPL-3.0-or-later
// Client for the Node backend (/api/*). Lists come as pages: { items, more } where more() loads the next page or is null.
// Falls back to the bundled demo data when the backend/YouTube is unreachable.
(function () {
  const D = window.DATA;
  const norm = v => ({ ...v, thumb: '/thumb/' + v.id, src: '/stream/' + v.id, views: v.views || 0, dur: v.dur || 0 });
  const demo = v => ({ ...v, thumb: v.clip.thumb, src: v.clip.src, demo: true });
  async function get(path) { const r = await fetch(path); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); }
  const cache = new Map();
  const remember = items => items.forEach(v => cache.set(v.id, v));
  // Wrap an endpoint that answers { items, next } into a page with a more() loader.
  function pager(url, map = norm) {
    const load = async c => {
      const r = await get(url + (c ? (url.includes('?') ? '&' : '?') + 'c=' + encodeURIComponent(c) : ''));
      remember(r.items);
      return { items: r.items.map(map), more: r.next ? () => load(r.next) : null, raw: r };
    };
    return load;
  }
  const demoPage = list => ({ items: list.map(demo), more: null });

  window.API = {
    live: true,
    async search(q) {
      try { return await pager('/api/search?q=' + encodeURIComponent(q))(); }
      catch (e) { window.API.live = false; const l = D.videos.filter(v => (v.title + ' ' + v.author).toLowerCase().includes(q.toLowerCase())); return demoPage(l.length ? l : D.videos); }
    },
    async home() {
      try {
        const first = await get('/api/home'); remember(first.items); window.API.personal = first.personal;
        const k = first.personal ? 'home' : 'search';
        const seenIds = first.items.map(v => v.id);
        // When the feed ends, keep going with "related" lists of videos from the feed (one after another), so scrolling never stops.
        const relatedChain = async () => {
          while (seenIds.length) {
            const id = seenIds.splice(Math.floor(Math.random() * Math.min(seenIds.length, 10)), 1)[0];
            try { const v = await this.video(id); const p = v.relatedPage; if (p.items.length) return chain(p); } catch (e) {}
          }
          return { items: [], more: null };
        };
        const chain = p => ({ items: p.items, more: p.more ? async () => chain(await p.more()) : relatedChain });
        const load = async c => {
          const r = await get('/api/home?k=' + k + '&c=' + encodeURIComponent(c)); remember(r.items); r.items.forEach(v => seenIds.push(v.id));
          if (!r.items.length) return relatedChain();
          return { items: r.items.map(norm), more: r.next ? () => load(r.next) : relatedChain };
        };
        return { items: first.items.map(norm), more: first.next ? () => load(first.next) : relatedChain };
      } catch (e) { window.API.personal = false; return this.search('trending music videos'); }
    },
    async video(id) {
      const d = D.videos.find(v => v.id === id);
      if (d) return { ...demo(d), relatedPage: demoPage(D.videos.filter(v => v.id !== id)), commentsPage: { items: D.comments, more: null } };
      const r = await get('/api/video?id=' + id); const base = cache.get(id) || {};
      const rel = pager('/api/related');
      return { ...base, ...norm(r), relatedPage: { items: r.related.map(norm), more: r.relatedNext ? () => rel(r.relatedNext) : null }, commentsToken: r.commentsToken };
    },
    async comments(token) {
      if (!token) return { items: [], more: null };
      const load = async t => { const r = await get('/api/comments?t=' + encodeURIComponent(t)); return { items: r.items, more: r.next ? () => load(r.next) : null }; };
      try { return await load(token); } catch (e) { return { items: [], more: null }; }
    },
    async chat(token, ms) { const r = await get('/api/chat?t=' + encodeURIComponent(token) + (ms != null ? '&ms=' + Math.floor(ms) : '')); return r; },
    async postJSON(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || 'Failed'); e.status = r.status; throw e; } return d; },
    addComment(id, text) { return this.postJSON('/api/comment', { id, text }); },
    sendChat(id, text) { return this.postJSON('/api/chat/send', { id, text }); },
    async authStatus() { try { return await get('/api/auth/status'); } catch (e) { return { signedIn: false }; } },
    async authStart() { const r = await fetch('/api/auth/start', { method: 'POST' }); if (!r.ok) throw new Error('sign-in unavailable'); return r.json(); },
    authPoll() { return get('/api/auth/poll'); },
    async authLogout() { await fetch('/api/auth/logout', { method: 'POST' }); },
  };
})();
