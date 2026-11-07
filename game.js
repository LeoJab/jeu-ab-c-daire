'use strict';
/* ==========================================================================
   Abécédaire — jeu multijoueur en ligne pour le hub ChadGangGames
   Modèle : l'hôte (1er de la salle) fait foi. Les joueurs lui envoient leurs
   actions, il publie l'état complet (versionné, keep:true) à tout le monde.
   ========================================================================== */
(function () {

  /* ------------------------------ Données ------------------------------ */
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const HARD = 'KQWXYZ';            // lettres dures : +5 s
  const HARD_BONUS = 5000;
  const INTRO_MS = 2800;            // petit délai de mise en scène au 1er tour
  const CONTEST_PENALTY = 4000;
  const VOTE_MS = 12000;
  const THEME_MS = 25000;           // temps pour choisir le thème avant passage auto
  const MAX_PLAYERS = 12;
  const THEMES = [
    ['🐾', 'Animaux'], ['🌍', 'Pays'], ['🏙️', 'Villes'], ['🍎', 'Fruits & légumes'],
    ['🧑', 'Prénoms'], ['💼', 'Métiers'], ['🍕', 'Nourriture'], ['⚽', 'Sports'],
    ['🎬', 'Films'], ['🎮', 'Jeux vidéo'], ['🏷️', 'Marques'], ['🎤', 'Chanteurs & groupes'],
    ['🛋️', 'Objets de la maison'], ['👕', 'Vêtements'], ['🦸', 'Super-héros'], ['📺', 'Séries & animés'],
    ['🥤', 'Boissons'], ['🎸', 'Instruments'], ['🦴', 'Corps humain'], ['🏛️', 'Capitales'],
    ['🏃', 'Verbes d\'action'], ['🎒', 'Dans un sac'], ['🌳', 'Nature'], ['🚗', 'Transports']
  ];
  const PAL = ['#ffd426', '#ff4d9d', '#2ee6a6', '#19c3ff', '#ff8a1f', '#ffffff', '#9b7bff'];
  const AVCOL = ['#ff4d6d', '#e0a800', '#14b886', '#7c5cff', '#ff8a1f', '#19a8e0', '#ff5cc8', '#6fb01f'];
  const RING = 289.03;

  /* ------------------------------ Utilitaires ------------------------------ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const now = () => performance.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const clean = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 40);
  const norm = s => String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const colorOf = id => {
    let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
    return AVCOL[x % AVCOL.length];
  };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function replay(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  /* Met à jour une liste d'éléments par clé, sans tout reconstruire. */
  function syncList(parent, items, key, make, update) {
    const existing = new Map([...parent.children].map(c => [c.dataset.k, c]));
    items.forEach((it, i) => {
      const k = String(key(it));
      let n = existing.get(k);
      if (n) existing.delete(k); else { n = make(it); n.dataset.k = k; }
      update(n, it);
      if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] || null);
    });
    existing.forEach(n => n.remove());
  }

  /* ------------------------------ SDK du hub (ou mode secours) ------------------------------ */
  function makeMock() {
    let id = safe(() => sessionStorage.getItem('abcMockId'));
    if (!id) { id = 'loc-' + Math.random().toString(36).slice(2, 7); safe(() => sessionStorage.setItem('abcMockId', id)); }
    const nm = () => (($('#pseudo') || {}).value || '').trim() || ('Joueur-' + id.slice(-3));
    return {
      mock: true,
      me: async () => ({ id, name: nm(), avatar: null, isAdmin: false, isModo: false, roles: [] }),
      room: () => new URLSearchParams(location.search).get('room'),
      join(code, opts) {
        const ch = new BroadcastChannel('abecedaire-' + code);
        const hs = {}, roster = new Map();
        let last = null;
        const emit = (e, ...a) => (hs[e] || []).forEach(f => f(...a));
        const self = { id, name: nm(), t: Date.now() };
        roster.set(id, self);
        const list = () => [...roster.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)).map(p => ({ id: p.id, name: p.name }));
        ch.onmessage = e => {
          const m = e.data;
          if (m.k === 'hello') { roster.set(m.p.id, m.p); ch.postMessage({ k: 'here', p: self, last }); emit('players', list()); }
          else if (m.k === 'here') { roster.set(m.p.id, m.p); if (m.last && !last) last = m.last; emit('players', list()); }
          else if (m.k === 'bye') { roster.delete(m.id); emit('players', list()); }
          else if (m.k === 'msg') { if (m.keep) last = m.data; emit('message', m.data, { id: m.from.id, name: m.from.name }); }
        };
        ch.postMessage({ k: 'hello', p: self });
        setTimeout(() => {
          if (opts && opts.create === false && roster.size < 2) { emit('error', 'Salle introuvable.'); return; }
          emit('ready', { me: id, players: list(), last });
        }, 350);
        addEventListener('pagehide', () => safe(() => ch.postMessage({ k: 'bye', id })));
        return {
          on(e, f) { (hs[e] = hs[e] || []).push(f); },
          send(data, o) {
            const keep = !!(o && o.keep);
            if (keep) last = data;
            ch.postMessage({ k: 'msg', data, keep, from: self });
            setTimeout(() => emit('message', data, { id: self.id, name: self.name }), 0);
          },
          leave() { safe(() => ch.postMessage({ k: 'bye', id })); safe(() => ch.close()); }
        };
      }
    };
  }
  const HUB = !!window.ChadGang;
  const SDK = window.ChadGang || makeMock();

  /* ------------------------------ État local ------------------------------ */
  let me = { id: 'local', name: 'Joueur' }, myAvatar = null;
  let room = null, roomCode = '', hubPlayers = [], avatars = {};
  let S = null;            // dernier état de la partie (publié par l'hôte)
  let rx = 0;              // moment local de réception de S
  let handledV = -1, actedV = -1, finSent = '', busy = false, busyT = 0;
  let lastTurnKey = '', lastSec = -1, lastEmote = 0, endReady = false;
  let msgText = '', msgErr = false, msgUntil = 0;

  const avatarOf = id => (id === me.id ? myAvatar : avatars[id]) || null;
  const isHost = () => !!(room && hubPlayers.length && hubPlayers[0].id === me.id);
  const nameOf = id => {
    const p = (S && S.players || []).find(x => x.id === id) || hubPlayers.find(x => x.id === id);
    return p ? p.name : 'Quelqu\'un';
  };
  const curPlayer = () => (S && S.players && S.players[S.turn]) || null;
  const iAmPlayer = () => !!(S && S.players && S.players.some(p => p.id === me.id));
  const myTurn = () => !!(S && S.phase === 'play' && curPlayer() && curPlayer().id === me.id);
  function remain() {
    if (!S) return 0;
    const el = now() - rx;
    if (S.phase === 'play') return S.turnLeft - el;
    if (S.phase === 'vote' && S.vote) return S.vote.left - el;
    if (S.phase === 'theme') return S.themeLeft - el;
    return 0;
  }
  const infinite = c => !!c && c.mode === 'infini';
  const letterAt = c => infinite(c) ? LETTERS[c.li % 26] : LETTERS[Math.min(c.li, 25)];
  const posAt = c => infinite(c) ? c.li % 26 : c.li;                 // position dans l'alphabet (0-26)
  const lapAt = c => infinite(c) ? Math.floor(c.li / 26) : 0;        // numéro du tour d'alphabet
  const turnTime = c => c.timeMs + (HARD.includes(letterAt(c)) ? HARD_BONUS : 0);

  /* ------------------------------ Avatars ------------------------------ */
  function setAvatar(node, id, name, url) {
    const sig = id + '|' + (url || '') + '|' + name;
    if (node._sig === sig) return;
    node._sig = sig;
    node.innerHTML = '';
    function fallback() {
      node.innerHTML = '';
      const f = h('span', 'av-fb');
      f.textContent = ((name || '?').trim().charAt(0) || '?').toUpperCase();
      f.style.background = colorOf(id);
      f.dataset.chadgangId = id;
      node.appendChild(f);
    }
    if (url) {
      const im = h('img');
      im.src = url; im.alt = name || ''; im.draggable = false;
      im.dataset.chadgangId = id;
      im.addEventListener('error', fallback);
      node.appendChild(im);
    } else fallback();
  }

  /* ------------------------------ Son ------------------------------ */
  let actx = null, muted = safe(() => localStorage.getItem('abc_mute')) === '1';
  function ac() {
    if (muted) return null;
    if (!actx) actx = safe(() => new (window.AudioContext || window.webkitAudioContext)());
    if (actx && actx.state === 'suspended') safe(() => actx.resume());
    return actx;
  }
  function tone(f, d, type, vol, delay, to) {
    const a = ac(); if (!a) return;
    safe(() => {
      const t = a.currentTime + (delay || 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
      g.gain.setValueAtTime(vol || .08, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + .02);
    });
  }
  const sfx = {
    tick: () => tone(1000, .05, 'square', .035),
    tickMe: () => tone(1300, .07, 'square', .06),
    turn: () => { tone(660, .1, 'triangle', .09); tone(990, .14, 'triangle', .09, .09); },
    ok: () => [660, 880, 1175].forEach((f, i) => tone(f, .14, 'triangle', .09, i * .07)),
    bad: () => { tone(220, .45, 'sawtooth', .09, 0, 55); tone(160, .45, 'square', .05, .05, 40); },
    alarm: () => [0, .18, .36].forEach(d => tone(800, .12, 'square', .06, d)),
    start: () => [392, 523, 659, 784].forEach((f, i) => tone(f, .18, 'triangle', .09, i * .09)),
    win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, .2, 'triangle', .1, i * .11)),
    pop: () => tone(520, .08, 'sine', .06, 0, 880)
  };

  /* ------------------------------ Effets visuels ------------------------------ */
  const bg = $('#bg'), fxc = $('#fx');
  const bctx = bg.getContext('2d'), fctx = fxc.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, parts = [], drift = [];
  function resize() {
    W = innerWidth; H = innerHeight;
    [bg, fxc].forEach(c => { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; });
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function initDrift() {
    drift = [];
    const n = calm ? 0 : 26;
    for (let i = 0; i < n; i++) drift.push({ x: rand(0, W), y: rand(0, H), s: rand(24, 90), v: rand(.15, .55), r: rand(-.4, .4), vr: rand(-.003, .003), c: LETTERS[i % 26] });
  }
  function emit(x, y, n, o) {
    for (let i = 0; i < n && parts.length < 700; i++) {
      const a = (o.angle != null ? o.angle : rand(0, Math.PI * 2)) + rand(-.5, .5) * (o.spread != null ? o.spread : Math.PI * 2);
      const sp = (o.speed || 8) * rand(.4, 1.1);
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.g == null ? .25 : o.g, drag: o.drag || .985,
        life: (o.life || 80) * rand(.7, 1.2), size: (o.size || 8) * rand(.7, 1.3), rot: rand(0, 6), vr: rand(-.3, .3),
        color: pick(o.colors || PAL), shape: o.shape || 'rect', ch: o.ch
      });
    }
  }
  const FX = {
    confetti: (x, y, n) => emit(x, y, calm ? 12 : (n || 80), { shape: 'rect', speed: 12, g: .3, life: 95, size: 9 }),
    sparks: (x, y, c, n) => emit(x, y, calm ? 8 : (n || 40), { shape: 'spark', colors: [c, '#fff'], speed: 9, g: .1, life: 45, size: 4 }),
    emojis: (x, y, ch, n) => emit(x, y, calm ? 3 : (n || 10), { shape: 'emoji', ch, speed: 9, g: .22, life: 75, size: 26 }),
    firework: (x, y) => { const c = pick(PAL); emit(x, y, calm ? 14 : 80, { shape: 'spark', colors: [c, '#fff'], speed: 10, g: .07, drag: .965, life: 75, size: 4 }); },
    rain: () => { for (let i = 0; i < (calm ? 20 : 140); i++) setTimeout(() => emit(rand(0, W), -10, 1, { angle: Math.PI / 2, spread: .6, shape: 'rect', speed: 5, g: .12, life: 220, size: 9 }), i * 14); }
  };
  function shock(x, y, color) {
    if (calm) return;
    const s = h('div', 'shock'); s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.color = color || '#ffd426';
    document.body.appendChild(s); setTimeout(() => s.remove(), 850);
  }
  function flash(color) { const f = $('#flash'); f.style.background = color; replay(f, 'go'); }
  function shake() { if (!calm) replay($('#app'), 'shake'); }
  function banner(text, cls) {
    const box = $('#banners'), b = h('div', 'banner ' + (cls || ''));
    b.textContent = text; box.appendChild(b);
    setTimeout(() => b.remove(), 1600);
    while (box.children.length > 3) box.firstChild.remove();
  }
  function center() {
    const el = $('#letterWrap');
    const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: W / 2, y: H / 2 };
  }
  function frame() {
    bctx.clearRect(0, 0, W, H);
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle'; bctx.fillStyle = '#fff';
    for (const d of drift) {
      d.y -= d.v; d.r += d.vr; if (d.y < -80) { d.y = H + 80; d.x = rand(0, W); }
      bctx.save(); bctx.globalAlpha = .06; bctx.translate(d.x, d.y); bctx.rotate(d.r);
      bctx.font = '900 ' + d.s + 'px Arial Black, sans-serif'; bctx.fillText(d.c, 0, 0); bctx.restore();
    }
    fctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (--p.life <= 0) { parts.splice(i, 1); continue; }
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      fctx.globalAlpha = Math.min(1, p.life / 22);
      if (p.shape === 'emoji') { fctx.font = p.size + 'px serif'; fctx.textAlign = 'center'; fctx.fillText(p.ch, p.x, p.y); continue; }
      fctx.fillStyle = p.color;
      if (p.shape === 'spark') { fctx.beginPath(); fctx.arc(p.x, p.y, p.size * Math.min(1, p.life / 30), 0, 7); fctx.fill(); }
      else { fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * .6); fctx.restore(); }
    }
    fctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  /* ------------------------------ Réseau ------------------------------ */
  function send(d, o) { if (room) safe(() => room.send(d, o)); }
  const sendHi = () => send({ t: 'hi', avatar: myAvatar });

  function joinRoom(code, create) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (code.length < 4) return setHomeErr('Le code fait au moins 4 lettres ou chiffres.');
    if (room) leaveRoom();
    if (!HUB) me.name = ($('#pseudo').value || '').trim() || me.name;
    roomCode = code; S = null; handledV = -1; actedV = -1; endReady = false;
    setHomeErr('Connexion à la salle…', true);
    try {
      room = SDK.join(code, { create: !!create });
    } catch (e) { room = null; return setHomeErr('Impossible de rejoindre la salle.'); }
    room.on('ready', onReady);
    room.on('players', onPlayers);
    room.on('message', onMessage);
    room.on('error', m => { leaveRoom(); setHomeErr(typeof m === 'string' ? m : 'Salle introuvable ou pleine.'); });
  }
  function leaveRoom() {
    safe(() => room && room.leave());
    room = null; S = null; hubPlayers = []; roomCode = ''; endReady = false; lastTurnKey = '';
    route(); render();
  }

  function onReady(info) {
    hubPlayers = info.players || [];
    if (info.me) me.id = info.me;
    const L = info.last;
    if (L && L.t === 'state' && L.s) { S = L.s; rx = now(); handledV = S.v; endReady = S.phase === 'end'; }
    sendHi();
    if (isHost()) {
      if (!S) commit(lobbyState(null));
      else if (S.phase !== 'lobby' && S.players.every(p => !hubPlayers.some(x => x.id === p.id))) commit(lobbyState(S));
      else reconcileGone();
    }
    setHomeErr('');
    route(); render();
  }
  function onPlayers(list) {
    hubPlayers = list || [];
    sendHi();
    if (isHost()) {
      if (!S) commit(lobbyState(null)); else reconcileGone();
    }
    route(); render();
  }
  function onMessage(d, from) {
    if (!d || !from) return;
    switch (d.t) {
      case 'hi': avatars[from.id] = d.avatar || null; render(); break;
      case 'state': {
        const s = d.s;
        if (!s || (S && s.v <= S.v)) break;
        const prev = S; S = s; rx = now(); afterState(prev); break;
      }
      case 'emote': showEmote(from.id, d.e); break;
      case 'rej': if (d.to === me.id) { busy = false; flashMsg(d.m || 'Mot refusé.', true); replay($('#wordForm'), 'bad'); } break;
      default: if (isHost()) hostHandle(d, from);
    }
  }

  /* ---- publication (hôte uniquement) ---- */
  function commit(next) {
    const prev = S;
    S = next; rx = now();
    send({ t: 'state', s: next }, { keep: true });
    afterState(prev);
  }
  function mut(fn) {
    const c = structuredClone(S);
    if (S.phase === 'play') c.turnLeft = remain();
    if (S.phase === 'vote' && c.vote) c.vote.left = remain();
    if (S.phase === 'theme') c.themeLeft = remain();
    c.ev = null;
    fn(c);
    c.v = S.v + 1;
    commit(c);
  }
  function lobbyState(prev) {
    return {
      v: (prev ? prev.v : 0) + 1, phase: 'lobby',
      timeMs: prev ? prev.timeMs : 15000, lives: prev ? prev.lives : 3, mode: prev && prev.mode ? prev.mode : 'classique',
      players: [], used: [], li: 0, ev: null
    };
  }

  /* ------------------------------ Logique de jeu (hôte) ------------------------------ */
  function checkWord(raw, st) {
    const w = clean(raw), n = norm(w);
    if (n.length < 1) return 'Écris un mot !';
    if (n[0] !== letterAt(st).toLowerCase()) return 'Ça doit commencer par ' + letterAt(st) + ' !';
    if (st.used.some(u => norm(u.w) === n)) return 'Déjà utilisé !';
    return null;
  }
  function nextTurn(c) {
    const n = c.players.length;
    for (let i = 1; i <= n; i++) {
      const j = (c.turn + i) % n;
      if (!c.players[j].out) { c.turn = j; break; }
    }
    c.turnMs = turnTime(c); c.turnLeft = c.turnMs;
  }
  function checkEnd(c) {
    const alive = c.players.filter(p => !p.out).length;
    return (!infinite(c) && c.li >= 26) || alive <= (c.practice ? 0 : 1);
  }
  function finish(c) {
    c.phase = 'end'; c.vote = null;
    const alive = c.players.filter(p => !p.out);
    let w = [];
    if (alive.length) { const mx = Math.max(...alive.map(p => p.lives)); w = alive.filter(p => p.lives === mx).map(p => p.id); }
    c.winners = w;
    c.ev = Object.assign({}, c.ev || {}, { end: true });
  }
  function hostStart() {
    if (!isHost() || !S || S.phase !== 'lobby') return;
    const list = shuffle(hubPlayers.slice(0, MAX_PLAYERS).map(p => ({ id: p.id, name: p.name, lives: S.lives, words: 0, gone: false, out: false })));
    commit({
      v: S.v + 1, phase: 'theme', partie: roomCode + '-' + Date.now().toString(36),
      theme: null, timeMs: S.timeMs, lives: S.lives, mode: S.mode || 'classique', practice: list.length < 2,
      players: list, turn: 0, li: 0, fails: 0, used: [], last: null, vote: null, winners: [],
      chooser: pick(list).id, passed: [], themeLeft: THEME_MS, ev: { k: 'chooser' }
    });
  }
  function hostBegin(theme, auto) {
    mut(c => {
      c.phase = 'play'; c.theme = theme; c.turn = 0; c.li = 0;
      c.turnMs = turnTime(c); c.turnLeft = c.turnMs + INTRO_MS;
      c.ev = { k: 'start', by: c.chooser, auto: !!auto };
      delete c.themeLeft;
    });
  }
  function hostPass() {
    if (S.phase !== 'theme') return;
    const old = S.chooser;
    const passed = S.passed.concat(old);
    const cand = S.players.filter(p => !passed.includes(p.id) && !p.gone);
    if (!cand.length) { hostBegin(pick(THEMES)[1], true); return; }
    mut(c => {
      c.passed = passed; c.chooser = pick(cand).id; c.themeLeft = THEME_MS;
      c.ev = { k: 'pass', by: old };
    });
  }
  function hostHandle(d, from) {
    if (!S) return;
    switch (d.t) {
      case 'theme': {
        if (S.phase !== 'theme' || from.id !== S.chooser || typeof d.theme !== 'string') break;
        const t = clean(d.theme).slice(0, 30);
        if (t.length >= 2) hostBegin(t, false);
        break;
      }
      case 'pass': if (S.phase === 'theme' && from.id === S.chooser) hostPass(); break;
      case 'word': if (typeof d.word === 'string') hostWord(from.id, d.word); break;
      case 'giveup': if (S.phase === 'play' && curPlayer() && curPlayer().id === from.id) hostLoseLife('giveup'); break;
      case 'contest': hostContest(from.id); break;
      case 'vote': hostVote(from.id, !!d.ok); break;
    }
  }
  function hostWord(id, raw) {
    if (S.phase !== 'play') return;
    const cur = curPlayer();
    if (!cur || cur.id !== id) return;
    const err = checkWord(raw, S);
    if (err) { send({ t: 'rej', to: id, m: err }); return; }
    const elapsed = S.turnMs - remain();
    const w = clean(raw);
    mut(c => {
      const p = c.players[c.turn], idx = c.li;
      c.used.push({ l: LETTERS[idx % 26], w, by: id, i: idx });
      if (infinite(c)) { const minI = (Math.floor(idx / 26) - 1) * 26; c.used = c.used.filter(u => u.i >= minI); }
      p.words++;
      c.last = { w, by: id, li: idx, contested: false };
      c.li++; c.fails = 0;
      c.ev = { k: 'ok', by: id, w, i: idx % 26, fast: elapsed < 4000, lap: infinite(c) && c.li % 26 === 0 ? c.li / 26 : 0 };
      if (!infinite(c) && c.li >= 26) finish(c); else nextTurn(c);
    });
  }
  function hostLoseLife(kind) {
    mut(c => {
      const p = c.players[c.turn];
      p.lives--; if (p.lives <= 0) { p.lives = 0; p.out = true; }
      c.fails++; c.last = null;
      let skipped = false;
      if (c.fails >= 2) { c.li++; c.fails = 0; skipped = true; }
      c.ev = { k: kind, by: p.id, out: p.out, skipped };
      if (checkEnd(c)) finish(c); else nextTurn(c);
    });
  }
  function hostContest(id) {
    if (S.phase !== 'play' || !S.last || S.last.contested || S.last.by === id) return;
    if (!S.players.some(p => p.id === id)) return;
    mut(c => {
      c.last.contested = true;
      c.pausedLeft = c.turnLeft;
      c.phase = 'vote';
      c.vote = { w: c.last.w, by: c.last.by, contester: id, votes: { [id]: false }, left: VOTE_MS };
      c.ev = { k: 'contest', by: id, w: c.last.w };
    });
    checkVoteDone();
  }
  function voters() { return hubPlayers.map(p => p.id).filter(id => S.vote && id !== S.vote.by); }
  function hostVote(id, ok) {
    if (S.phase !== 'vote' || !S.vote || id === S.vote.by || id in S.vote.votes) return;
    mut(c => { c.vote.votes[id] = ok; c.ev = { k: 'vote' }; });
    checkVoteDone();
  }
  function checkVoteDone() {
    if (S.phase === 'vote' && voters().every(id => id in S.vote.votes)) resolveVote();
  }
  function resolveVote() {
    if (S.phase !== 'vote') return;
    mut(c => {
      const v = c.vote;
      const vals = Object.entries(v.votes).filter(e => e[0] !== v.by).map(e => e[1]);
      const no = vals.filter(x => !x).length, yes = vals.length - no;
      const refused = no > yes;
      c.phase = 'play'; c.vote = null;
      if (refused) {
        const a = c.players.find(p => p.id === v.by);
        const li = c.last ? c.last.li : c.li - 1;
        c.used = c.used.filter(u => !(u.w === v.w && u.by === v.by));
        if (a) { a.words = Math.max(0, a.words - 1); a.lives--; if (a.lives <= 0) { a.lives = 0; a.out = true; } }
        c.li = li; c.fails = 0; c.last = null;
        c.ev = { k: 'refused', by: v.by, w: v.w, out: !!(a && a.out), yes, no };
        if (checkEnd(c)) finish(c);
        else { c.turnMs = turnTime(c); c.turnLeft = c.turnMs; }
      } else {
        const cur = c.players[c.turn];
        const pen = cur && cur.id === v.contester ? CONTEST_PENALTY : 0;
        c.turnLeft = Math.max(2000, (c.pausedLeft || 5000) - pen);
        c.ev = { k: 'kept', by: v.by, w: v.w, yes, no, penalty: pen > 0 };
      }
      delete c.pausedLeft;
    });
  }
  function reconcileGone() {
    if (!S || S.phase === 'lobby' || S.phase === 'end' || !isHost()) return;
    const diff = S.players.some(p => p.gone === hubPlayers.some(x => x.id === p.id));
    if (diff) mut(c => { c.players.forEach(p => { p.gone = !hubPlayers.some(x => x.id === p.id); }); });
    if (S.phase === 'vote') checkVoteDone();
  }
  function hostCfg(patch) {
    if (!isHost() || !S || S.phase !== 'lobby') return;
    mut(c => Object.assign(c, patch));
  }
  function hostAgain() { if (isHost() && S && S.phase === 'end') commit(lobbyState(S)); }

  /* ------------------------------ Réaction à un nouvel état ------------------------------ */
  function afterState(prev) {
    busy = false;
    if (S.phase === 'end' && (!prev || prev.phase !== 'end')) {
      endReady = handledV >= S.v && !prev;        // arrivée directe sur un écran de fin : pas d'attente
      if (!endReady) setTimeout(() => { endReady = true; render(); }, 1700);
    }
    if (S.phase !== 'end') endReady = false;
    route(); render();
    if (S.v > handledV) {
      handledV = S.v;
      if (S.ev) onEvent(S.ev);
    }
    // à moi de jouer ?
    const key = S.partie + ':' + S.turn + ':' + S.li + ':' + S.phase;
    if (myTurn() && key !== lastTurnKey) {
      const inp = $('#wordInput');
      if (!(prev && prev.phase === 'vote')) inp.value = '';
      setTimeout(() => safe(() => inp.focus()), 50);
      if (S.ev && S.ev.k !== 'start') { sfx.turn(); safe(() => navigator.vibrate && navigator.vibrate(60)); banner('À TOI !', 'go'); }
    }
    lastTurnKey = myTurn() ? key : '';
    reportResult();
  }
  function reportResult() {
    if (!S || S.phase !== 'end' || S.practice || finSent === S.partie) return;
    if (!iAmPlayer()) return;
    finSent = S.partie;
    const p = S.players.find(x => x.id === me.id);
    if (window.ChadGang && ChadGang.finPartie) {
      safe(() => Promise.resolve(ChadGang.finPartie({ gagne: S.winners.includes(me.id), partie: S.partie, score: p ? p.words : 0 })).catch(() => {}));
    }
  }

  function onEvent(ev) {
    const c = center();
    const who = nameOf(ev.by);
    switch (ev.k) {
      case 'chooser':
        sfx.start(); banner('🎲 TIRAGE AU SORT !', 'big'); FX.confetti(W / 2, H / 3, 50);
        setTimeout(() => { if (S && S.phase === 'theme') banner('👉 ' + nameOf(S.chooser).toUpperCase()); }, 900);
        break;
      case 'pass':
        sfx.bad(); banner('⏭️ ' + who + ' PASSE !'); flash('#19c3ff');
        setTimeout(() => { if (S && S.phase === 'theme') { banner('👉 ' + nameOf(S.chooser).toUpperCase()); sfx.pop(); } }, 900);
        break;
      case 'start':
        sfx.start(); banner('🔤 ' + S.theme.toUpperCase(), 'big');
        if (ev.auto) setTimeout(() => banner('🎲 THÈME AU HASARD'), 500);
        FX.firework(W * .3, H * .3); FX.firework(W * .7, H * .3);
        setTimeout(() => { if (S && S.phase === 'play') { banner('C\'EST PARTI !', 'go'); sfx.pop(); } }, 1300);
        break;
      case 'ok':
        sfx.ok(); FX.confetti(c.x, c.y, ev.by === me.id ? 120 : 70); shock(c.x, c.y, '#ffd426');
        { const cell = $('#ribbon').children[ev.i]; if (cell) replay(cell, 'just'); }
        replay($('#lastWord'), 'pop');
        if (ev.lap) { setTimeout(() => { banner('🔁 TOUR ' + ev.lap + ' TERMINÉ !', 'big'); sfx.win(); FX.firework(W * .25, H * .35); FX.firework(W * .75, H * .35); FX.rain(); }, 500); setTimeout(() => banner('ON REPART EN A !', 'go'), 1500); }
        if (ev.fast) { banner('⚡ ÉCLAIR !'); FX.sparks(c.x, c.y, '#19c3ff', 50); }
        break;
      case 'timeout': case 'giveup':
        sfx.bad(); shake(); flash('#ff2d55'); FX.emojis(c.x, c.y, '💔', 12); shock(c.x, c.y, '#ff3b5c');
        banner(ev.k === 'giveup' ? '😵 ' + who + ' sèche !' : '💥 TEMPS ÉCOULÉ !', 'ko');
        if (ev.skipped) setTimeout(() => banner('🔒 LETTRE MAUDITE → SUIVANTE'), 600);
        if (ev.out) setTimeout(() => { banner('☠️ ' + who + ' ÉLIMINÉ', 'ko'); FX.emojis(c.x, c.y, '💀', 10); sfx.bad(); }, ev.skipped ? 1200 : 700);
        break;
      case 'contest':
        sfx.alarm(); flash('#ffd426'); banner('🚩 CONTESTÉ !', 'ko');
        break;
      case 'refused':
        sfx.bad(); shake(); flash('#ff2d55'); banner('❌ MOT REFUSÉ', 'ko'); FX.emojis(c.x, c.y, '💔', 10);
        if (ev.out) setTimeout(() => { banner('☠️ ' + who + ' ÉLIMINÉ', 'ko'); FX.emojis(c.x, c.y, '💀', 10); }, 800);
        break;
      case 'kept':
        sfx.ok(); banner('✅ MOT VALIDÉ'); FX.confetti(c.x, c.y, 40);
        if (ev.penalty) setTimeout(() => banner('⏱️ −4 s pour le contestataire'), 700);
        break;
      case 'vote': sfx.pop(); break;
    }
    if (ev.end) setTimeout(endFx, 700);
  }
  function endFx() {
    if (!S || S.phase !== 'end') return;
    if (S.winners.length) {
      sfx.win();
      let i = 0;
      const iv = setInterval(() => { FX.firework(rand(.12, .88) * W, rand(.1, .5) * H); if (++i > 14) clearInterval(iv); }, 260);
      if (S.winners.includes(me.id)) FX.rain();
    } else sfx.bad();
  }
  function showEmote(id, e) {
    const card = $('#gPlayers [data-k="' + CSS.escape(id) + '"]');
    const r = card ? card.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0 };
    const f = h('div', 'floaty'); f.textContent = e;
    f.style.left = (r.left + r.width / 2 - 14 + rand(-10, 10)) + 'px'; f.style.top = (r.top) + 'px';
    document.body.appendChild(f); setTimeout(() => f.remove(), 1700);
  }

  /* ------------------------------ Affichage ------------------------------ */
  function route() {
    const scr = !room ? 'home' : (!S || S.phase === 'lobby') ? 'lobby' : S.phase === 'theme' ? 'theme' : 'game';
    ['home', 'lobby', 'theme', 'game'].forEach(n => $('#sc-' + n).classList.toggle('hidden', n !== scr));
    $('#btnLeave').classList.toggle('hidden', !room);
    if (scr !== 'game') { $('#voteOverlay').classList.add('hidden'); $('#endOverlay').classList.add('hidden'); }
  }
  function render() {
    if (!room) return renderHome();
    if (!S || S.phase === 'lobby') return renderLobby();
    if (S.phase === 'theme') return renderTheme();
    renderGame();
  }
  function setHomeErr(t, info) {
    const e = $('#homeErr'); e.textContent = t || ''; e.style.color = info ? '#2433f2' : '';
  }
  function renderHome() {
    $('#profile').classList.toggle('hidden', !HUB);
    $('#pseudoRow').classList.toggle('hidden', HUB);
    if (HUB) { setAvatar($('#hmeAv'), me.id, me.name, myAvatar); $('#hmeName').textContent = me.name; }
  }

  function renderLobby() {
    $('#roomCode').textContent = roomCode;
    const host = isHost(), cfg = S || { timeMs: 15000, lives: 3 };
    syncList($('#lobPlayers'), hubPlayers, p => p.id,
      () => { const d = h('div', 'lcard', '<span class="av"></span><span class="lname"></span>'); return d; },
      (n, p) => {
        setAvatar(n.firstChild, p.id, p.name, avatarOf(p.id));
        n.lastChild.textContent = (hubPlayers[0] && hubPlayers[0].id === p.id ? '👑 ' : '') + p.name + (p.id === me.id ? ' (toi)' : '');
      });
    $$('#segTime button').forEach(b => { b.classList.toggle('on', +b.dataset.v === cfg.timeMs); b.disabled = !host; });
    $$('#segMode button').forEach(b => { b.classList.toggle('on', b.dataset.v === (cfg.mode || 'classique')); b.disabled = !host; });
    $$('#segLives button').forEach(b => { b.classList.toggle('on', +b.dataset.v === cfg.lives); b.disabled = !host; });
    $('#btnStart').classList.toggle('hidden', !host);
    $('#waitHost').classList.toggle('hidden', host);
    const n = hubPlayers.length;
    $('#startHint').textContent = n < 2 ? 'Seul dans la salle ? Tu peux t\'entraîner (partie non classée).' : n + ' joueurs prêts à se battre ⚔️';
  }

  function renderTheme() {
    const ch = S.players.find(p => p.id === S.chooser) || { id: S.chooser, name: '?' };
    const mine = ch.id === me.id;
    setAvatar($('#thAv'), ch.id, ch.name, avatarOf(ch.id));
    $('#thTitle').textContent = mine ? '🎲 À toi de choisir le thème !' : '🎲 ' + ch.name + ' choisit le thème…';
    $('#thSub').textContent = S.passed.length ? 'Ont passé : ' + S.passed.map(nameOf).join(', ') : (mine ? 'Pas d\'idée ? Clique sur « Passer ».' : 'Patience, ça arrive…');
    $('#thCtl').classList.toggle('hidden', !mine);
    $('#thWait').classList.toggle('hidden', mine);
    $('#thWait').textContent = iAmPlayer() ? 'Si ' + ch.name + ' passe, un autre joueur sera tiré au sort.' : '👀 Tu regardes la partie';
    if (!mine) $('#customTheme').blur();
  }

  function flashMsg(t, err) { msgText = t; msgErr = !!err; msgUntil = now() + 2600; renderMsg(); setTimeout(renderMsg, 2700); }
  function renderMsg() {
    const m = $('#msgLine');
    if (!S || S.phase === 'lobby') return;
    let t = '', err = false;
    if (now() < msgUntil) { t = msgText; err = msgErr; }
    else if (S.phase === 'end') t = '';
    else if (S.phase === 'vote') t = '🗳️ Les joueurs votent…';
    else if (!iAmPlayer()) t = '👀 Tu regardes la partie';
    else if (myTurn()) t = 'Un mot « ' + S.theme + ' » en ' + letterAt(S) + ' !';
    else if (curPlayer()) t = '✍️ ' + curPlayer().name + ' réfléchit…';
    m.textContent = t; m.classList.toggle('err', err);
  }

  function renderGame() {
    const st = S, cur = curPlayer(), play = st.phase === 'play';
    $('#gTheme').textContent = '🎯 ' + st.theme;
    $('#gMode').textContent = (infinite(st) ? '♾️ Infini · ' : '') + (st.practice ? '🏋️ Entraînement' : '👥 ' + st.players.length + ' joueurs') + (infinite(st) && st.li >= 26 ? ' · tour ' + (lapAt(st) + 1) : '');

    // ruban A–Z
    const rb = $('#ribbon');
    if (!rb.children.length) LETTERS.forEach(l => { const c = h('div', 'cell'); c.textContent = l; rb.appendChild(c); });
    const done = {}, lap = lapAt(st); st.used.forEach(u => { if (!infinite(st) || Math.floor(u.i / 26) === lap) done[u.l] = u.w; });
    LETTERS.forEach((l, i) => {
      const c = rb.children[i], d = l in done;
      c.classList.toggle('done', d);
      c.classList.toggle('cur', i === posAt(st) && st.phase !== 'end');
      c.classList.toggle('skip', !d && i < posAt(st));
      c.title = d ? done[l] : '';
    });

    // joueurs
    syncList($('#gPlayers'), st.players, p => p.id,
      () => h('div', 'pcard', '<span class="av"></span><div class="pinfo"><div class="pname"></div><div class="pmeta"></div></div><span class="pko">KO</span>'),
      (n, p) => {
        setAvatar(n.firstChild, p.id, p.name, avatarOf(p.id));
        $('.pname', n).textContent = p.name + (p.id === me.id ? ' (toi)' : '');
        $('.pmeta', n).textContent = '❤️'.repeat(Math.max(0, p.lives)) + '🖤'.repeat(Math.max(0, st.lives - p.lives)) + ' · ' + p.words + ' mot' + (p.words > 1 ? 's' : '');
        n.classList.toggle('turn', play && cur && cur.id === p.id);
        n.classList.toggle('out', p.out);
        n.classList.toggle('gone', !!p.gone);
        if (n._lives != null && p.lives < n._lives) replay(n, 'hurt');
        n._lives = p.lives;
      });

    // lettre
    const L = letterAt(st), bl = $('#bigLetter');
    if (bl.dataset.l !== L) { bl.dataset.l = L; bl.textContent = L; replay(bl, 'flip'); }

    // qui joue
    const tw = $('#twText');
    if (st.phase === 'end') { tw.textContent = '🏁 Partie terminée'; setAvatar($('#twAv'), 'x', '🏁', null); $('#twAv').style.visibility = 'hidden'; }
    else if (st.phase === 'vote') { tw.textContent = '🚩 Vote en cours…'; }
    else if (cur) {
      $('#twAv').style.visibility = 'visible';
      setAvatar($('#twAv'), cur.id, cur.name, avatarOf(cur.id));
      tw.textContent = cur.id === me.id ? 'C\'est à toi, ' + cur.name + ' !' : 'Au tour de ' + cur.name + (cur.gone ? ' (déconnecté…)' : '');
    }
    if (st.phase !== 'end') $('#twAv').style.visibility = 'visible';

    // dernier mot
    const lw = $('#lastWord');
    if (st.last) {
      lw.classList.remove('empty');
      setAvatar($('#lwAv'), st.last.by, nameOf(st.last.by), avatarOf(st.last.by));
      const t = $('#lwText'); t.innerHTML = ''; const b = h('b'); b.textContent = '« ' + st.last.w + ' »';
      t.appendChild(b); t.appendChild(document.createTextNode(' par ' + nameOf(st.last.by)));
    } else {
      lw.classList.add('empty');
      $('#lwText').textContent = 'Thème : ' + st.theme + ' — trouve un mot en ' + L;
    }

    // saisie + boutons
    const can = myTurn() && !busy;
    $('#wordInput').disabled = !can; $('#btnSend').disabled = !can;
    $('#wordInput').placeholder = myTurn() ? 'Un mot en ' + L + '…' : 'Attends ton tour…';
    $('#btnContest').classList.toggle('hidden', !(play && st.last && !st.last.contested && st.last.by !== me.id && iAmPlayer()));
    $('#btnGiveup').classList.toggle('hidden', !myTurn());
    renderMsg();

    // mots joués
    syncList($('#gLog'), st.used.slice(-14).reverse(), u => u.l + u.w,
      () => h('div', 'lchip', '<span class="av sm"></span><b></b><span class="lw"></span>'),
      (n, u) => { setAvatar(n.firstChild, u.by, nameOf(u.by), avatarOf(u.by)); $('b', n).textContent = u.l; $('.lw', n).textContent = u.w; });

    renderVote();
    renderEnd();
  }

  function renderVote() {
    const ov = $('#voteOverlay'), v = S.vote;
    if (S.phase !== 'vote' || !v) { ov.classList.add('hidden'); return; }
    ov.classList.remove('hidden');
    $('#vTitle').textContent = '🚩 ' + nameOf(v.contester) + ' conteste !';
    $('#vWord').textContent = '« ' + v.w + ' »';
    $('#vSub').textContent = 'de ' + nameOf(v.by) + ' — thème : ' + S.theme + ' — lettre ' + (S.last ? LETTERS[S.last.li % 26] : '');
    const vs = voters().map(id => ({ id }));
    syncList($('#vVoters'), vs, x => x.id,
      () => h('div', 'vv', '<span class="av"></span><em></em>'),
      (n, x) => {
        setAvatar(n.firstChild, x.id, nameOf(x.id), avatarOf(x.id));
        const val = v.votes[x.id];
        $('em', n).textContent = val === undefined ? '…' : val ? '✅' : '❌';
      });
    const eligible = voters().includes(me.id), voted = me.id in v.votes;
    $('#vBtns').classList.toggle('hidden', !eligible || voted);
    const w = $('#vWait');
    w.classList.toggle('hidden', eligible && !voted);
    w.textContent = me.id === v.by ? 'Les autres décident du sort de ton mot…' : voted ? 'Vote enregistré, on attend les autres…' : 'Tu regardes le vote.';
  }

  function renderEnd() {
    const ov = $('#endOverlay');
    if (S.phase !== 'end' || !endReady) { ov.classList.add('hidden'); return; }
    ov.classList.remove('hidden');
    const win = S.winners.map(id => S.players.find(p => p.id === id)).filter(Boolean);
    if (win.length === 1) {
      $('#eTitle').textContent = '🏆 ' + win[0].name + ' gagne !';
      $('#eAv').style.display = ''; setAvatar($('#eAv'), win[0].id, win[0].name, avatarOf(win[0].id));
    } else if (win.length > 1) {
      $('#eTitle').textContent = '🤝 Égalité : ' + win.map(p => p.name).join(' & ');
      $('#eAv').style.display = ''; setAvatar($('#eAv'), win[0].id, win[0].name, avatarOf(win[0].id));
    } else { $('#eTitle').textContent = '💀 Personne n\'a survécu…'; $('#eAv').style.display = 'none'; }
    const n = S.players.reduce((a, p) => a + p.words, 0);
    $('#eSub').textContent = infinite(S)
      ? '♾️ ' + n + ' mot' + (n > 1 ? 's' : '') + ' en ' + (Math.floor(S.li / 26) + (S.li % 26 ? 1 : 0)) + ' tour(s) d\'alphabet — thème : ' + S.theme + (S.practice ? ' (entraînement, non classé)' : '')
      : (S.li >= 26 ? '🎉 Alphabet complet ! Thème : ' + S.theme : n + ' lettre' + (n > 1 ? 's' : '') + ' sur 26 — thème : ' + S.theme + (S.practice ? ' (entraînement, non classé)' : ''));
    const rank = [...S.players].sort((a, b) => (S.winners.includes(b.id) - S.winners.includes(a.id)) || (!a.out - !b.out) || (b.lives - a.lives) || (b.words - a.words));
    syncList($('#eList'), rank, p => p.id,
      () => h('div', 'erow', '<span class="av"></span><span class="ename"></span><small></small>'),
      (el, p) => {
        setAvatar(el.firstChild, p.id, p.name, avatarOf(p.id));
        $('.ename', el).textContent = (S.winners.includes(p.id) ? '🏆 ' : '') + p.name + (p.id === me.id ? ' (toi)' : '');
        $('small', el).textContent = (p.out ? '☠️' : '❤️'.repeat(p.lives)) + ' · ' + p.words + ' mot' + (p.words > 1 ? 's' : '');
        el.classList.toggle('win', S.winners.includes(p.id));
      });
    const host = isHost();
    $('#btnAgain').classList.toggle('hidden', !host);
    $('#waitAgain').classList.toggle('hidden', host);
  }

  /* ------------------------------ Boucle d'horloge ------------------------------ */
  function tick() {
    if (!S) return;
    if (S.phase === 'theme') {
      const r = remain();
      $('#thBar').style.width = clamp(r / THEME_MS, 0, 1) * 100 + '%';
      if (isHost() && actedV !== S.v) {
        const ch = S.players.find(p => p.id === S.chooser);
        if (r <= 0 || (ch && ch.gone && THEME_MS - r > 3000)) { actedV = S.v; hostPass(); }
      }
      return;
    }
    if (S.phase === 'play') {
      const r = remain(), frac = clamp(r / S.turnMs, 0, 1);
      $('#ringFg').style.strokeDashoffset = String(RING * (1 - frac));
      const sec = clamp(Math.ceil(r / 1000), 0, Math.ceil(S.turnMs / 1000));
      $('#count').textContent = String(sec);
      const warn = r < 5000 && r > 0;
      $('#letterWrap').classList.toggle('warn', warn);
      if (sec !== lastSec) {
        lastSec = sec;
        if (warn) (myTurn() ? sfx.tickMe : sfx.tick)();
      }
      if (isHost() && actedV !== S.v) {
        const cur = curPlayer();
        const goneTooLong = cur && cur.gone && (S.turnMs - r) > 4000;
        if (r <= 0 || goneTooLong) { actedV = S.v; hostLoseLife('timeout'); }
      }
    } else {
      $('#letterWrap').classList.remove('warn');
      if (S.phase === 'vote' && S.vote) {
        const r = remain();
        $('#vBar').style.width = clamp(r / VOTE_MS, 0, 1) * 100 + '%';
        if (isHost() && actedV !== S.v && r <= 0) { actedV = S.v; resolveVote(); }
      }
    }
    if (busy && now() - busyT > 3000) { busy = false; render(); }
  }

  /* ------------------------------ Actions du joueur ------------------------------ */
  function submitWord() {
    if (!myTurn() || busy) return;
    const inp = $('#wordInput'), raw = inp.value;
    const err = checkWord(raw, S);
    if (err) { flashMsg(err, true); replay($('#wordForm'), 'bad'); sfx.bad(); return; }
    busy = true; busyT = now();
    $('#wordInput').disabled = true; $('#btnSend').disabled = true;
    send({ t: 'word', word: clean(raw) });
  }

  function buildThemes() {
    const g = $('#themeGrid');
    THEMES.forEach(([e, t]) => {
      const b = h('button', 'tchip'); b.type = 'button'; b.dataset.t = t; b.textContent = e + ' ' + t;
      g.appendChild(b);
    });
  }
  function openRules() { $('#modalRules').classList.remove('hidden'); }
  function closeRules() {
    $('#modalRules').classList.add('hidden');
    safe(() => localStorage.setItem('abc_rules_seen', '1'));
  }
  const rulesSeen = () => safe(() => localStorage.getItem('abc_rules_seen')) === '1';
  function newRoomCode() {
    const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let s = ''; for (let i = 0; i < 4; i++) s += al[Math.floor(Math.random() * al.length)];
    return s;
  }

  function bind() {
    $('#btnRules').onclick = openRules;
    $('#btnCloseRules').onclick = closeRules;
    $('#modalRules').addEventListener('click', e => { if (e.target.id === 'modalRules') closeRules(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modalRules').classList.contains('hidden')) closeRules(); });
    $('#btnSound').textContent = muted ? '🔇' : '🔊';
    $('#btnSound').onclick = () => {
      muted = !muted; safe(() => localStorage.setItem('abc_mute', muted ? '1' : '0'));
      $('#btnSound').textContent = muted ? '🔇' : '🔊'; if (!muted) sfx.pop();
    };
    $('#btnLeave').onclick = leaveRoom;
    $('#btnQuit').onclick = leaveRoom;
    $('#btnCreate').onclick = () => { ac(); joinRoom(newRoomCode(), true); };
    $('#btnJoin').onclick = () => { ac(); joinRoom($('#code').value, false); };
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
    $('#btnCopy').onclick = () => {
      safe(() => navigator.clipboard.writeText(roomCode));
      $('#btnCopy').textContent = '✅ Copié !'; setTimeout(() => { $('#btnCopy').textContent = '📋 Copier'; }, 1400);
    };
    $('#themeGrid').addEventListener('click', e => { const b = e.target.closest('.tchip'); if (b && S && S.chooser === me.id) send({ t: 'theme', theme: b.dataset.t }); });
    $('#btnPass').onclick = () => { if (S && S.chooser === me.id) send({ t: 'pass' }); };
    $('#segTime').addEventListener('click', e => { const b = e.target.closest('button'); if (b) hostCfg({ timeMs: +b.dataset.v }); });
    $('#segMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) hostCfg({ mode: b.dataset.v }); });
    $('#segLives').addEventListener('click', e => { const b = e.target.closest('button'); if (b) hostCfg({ lives: +b.dataset.v }); });
    const setCustom = () => { const v = clean($('#customTheme').value).slice(0, 30); if (v.length >= 2 && S && S.chooser === me.id) { send({ t: 'theme', theme: v }); $('#customTheme').value = ''; } };
    $('#btnCustom').onclick = setCustom;
    $('#customTheme').addEventListener('keydown', e => { if (e.key === 'Enter') setCustom(); });
    $('#btnDice').onclick = () => { if (S && S.chooser === me.id) { sfx.pop(); send({ t: 'theme', theme: pick(THEMES)[1] }); } };
    $('#btnStart').onclick = () => { ac(); hostStart(); };
    $('#btnAgain').onclick = hostAgain;
    $('#wordForm').addEventListener('submit', e => { e.preventDefault(); submitWord(); });
    $('#btnGiveup').onclick = () => { if (myTurn()) send({ t: 'giveup' }); };
    $('#btnContest').onclick = () => send({ t: 'contest' });
    $('#btnYes').onclick = () => send({ t: 'vote', ok: true });
    $('#btnNo').onclick = () => send({ t: 'vote', ok: false });
    $('#emotes').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || now() - lastEmote < 400) return;
      lastEmote = now(); send({ t: 'emote', e: b.dataset.e });
    });
    addEventListener('resize', () => { resize(); initDrift(); });
    addEventListener('pagehide', () => safe(() => room && room.leave()));
  }

  /* ------------------------------ Démarrage ------------------------------ */
  async function boot() {
    resize(); initDrift(); buildThemes(); bind();
    requestAnimationFrame(frame);
    setInterval(tick, 100);
    try { const m = await SDK.me(); if (m) me = m; } catch (e) { /* mode secours */ }
    if (!me.id) me.id = 'local-' + Math.random().toString(36).slice(2, 7);
    myAvatar = me.avatar || null;
    renderHome();
    const rc = safe(() => SDK.room && SDK.room());
    if (rc) { $('#code').value = String(rc).toUpperCase(); joinRoom(rc, false); }
    if (!rulesSeen()) { openRules(); }
  }
  boot();
})();
