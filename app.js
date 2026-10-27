import { computeBoosters, consumeBooster, MAX_BOOSTERS, REFILL_MS, openPack, packConfigFor, rarityInfo } from './engine.js';
import { loadState, saveState, parseSave } from './state.js';
import { getSets, getSetData, artUrl, cropUrl, boosterUrl, ICONIC } from './data.js';

let S = loadState();
let tab = 'home';
let setFilter = { q: '', sort: 'new' };
let colSet = null;           // extension affichée dans la collection
let colFilter = { own: 'all', rarity: 'all' };
let timerId = null;

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.id);
  toast.id = setTimeout(() => (t.hidden = true), 2600);
}

/** Met à jour le stock selon l'heure, sauvegarde, retourne la vue. */
function tick() {
  const v = computeBoosters(S, Date.now());
  S = { ...S, boosters: v.boosters, lastRefillAt: v.lastRefillAt, lastSeenAt: v.lastSeenAt };
  saveState(S);
  return v;
}
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

// ---------- Carte (composant) ----------
function cardHtml(card, rarity, { big = false, showName = true, badge = true } = {}) {
  const r = rarityInfo(rarity);
  return `<div class="card ${big ? 'lg' : ''} t${r.tier}" data-fx="${r.fx}">
    <img src="${artUrl(card.a)}" alt="${esc(card.n)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('noimg')">
    <div class="fx"></div><div class="fxn"></div><div class="spk"></div>
    ${badge && r.tier > 0 ? `<span class="rbadge">${esc(r.label)}</span>` : ''}
    <div class="cname">${esc(card.n)}</div>
  </div>`;
}

/** Effet holo piloté par le doigt/la souris. */
function bindTilt(el, strength = 14) {
  const card = $('.card', el) || el;
  const move = (x, y) => {
    const b = el.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (x - b.left) / b.width));
    const py = Math.min(1, Math.max(0, (y - b.top) / b.height));
    card.classList.add('tilting');
    card.style.setProperty('--mx', px * 100 + '%');
    card.style.setProperty('--my', py * 100 + '%');
    card.style.setProperty('--ang', Math.round(px * 360) + 'deg');
    card.style.transform = `rotateY(${(px - .5) * strength * 2}deg) rotateX(${(.5 - py) * strength * 2}deg)`;
  };
  const reset = () => { card.classList.remove('tilting'); card.style.transform = ''; card.style.setProperty('--mx', '50%'); card.style.setProperty('--my', '50%'); };
  el.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
  el.addEventListener('pointerdown', (e) => move(e.clientX, e.clientY));
  el.addEventListener('pointerleave', reset);
  el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') reset(); });
}

// ---------- Bandeaux de monstres emblématiques ----------
function banner(ids, title, sub) {
  const imgs = ids.map((id, i) => `<img src="${cropUrl(id)}" alt="" class="${i === 0 ? 'on' : ''}" onerror="this.remove()">`).join('');
  return `<header class="hero"><div class="hero-art">${imgs}</div><div class="hero-fade"></div>
    <div class="hero-txt"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></header>`;
}
let heroTimer = null;
function startHero() {
  clearInterval(heroTimer);
  const imgs = [...document.querySelectorAll('.hero-art img')];
  if (imgs.length < 2) return;
  let k = 0;
  heroTimer = setInterval(() => {
    if (!document.querySelector('.hero-art')) return clearInterval(heroTimer);
    imgs[k % imgs.length].classList.remove('on');
    k++;
    imgs[k % imgs.length].classList.add('on');
  }, 4500);
}

// ---------- Navigation ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
function go(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  clearInterval(timerId);
  clearInterval(heroTimer);
  view.scrollTop = 0;
  ({ home: renderHome, sets: renderSets, collection: renderCollection, profile: renderProfile })[t]();
}

// ---------- Accueil ----------
function renderHome() {
  const lastCards = S.hist.slice(0, 12);
  view.innerHTML = `
    ${banner([ICONIC.blueEyes, ICONIC.darkMagician, ICONIC.redEyes, ICONIC.exodia, ICONIC.slifer, ICONIC.obelisk, ICONIC.ra], 'Duel Packs', 'Ouvre des boosters, complète tes extensions.')}
    <section class="stock">
      <div class="big"><span id="n">0</span><small> / ${MAX_BOOSTERS}</small></div>
      <div class="pips" id="pips"></div>
      <div class="timer" id="timer"></div>
    </section>
    <div style="height:14px"></div>
    <button class="btn" id="go">Choisir une extension</button>
    <h2>Dernières cartes obtenues</h2>
    <div class="last" id="last">${lastCards.length ? '' : '<div class="empty" style="width:100%">Aucune carte pour l’instant.</div>'}</div>`;
  $('#go').onclick = () => go('sets');
  startHero();
  const last = $('#last');
  lastCards.forEach((h) => {
    const d = document.createElement('div');
    d.className = 'mini';
    d.innerHTML = cardHtml({ a: h.a, n: h.n }, h.r, { showName: false, badge: false });
    last.appendChild(d);
  });
  const draw = () => {
    const v = tick();
    $('#n').textContent = v.boosters;
    $('#pips').innerHTML = Array.from({ length: MAX_BOOSTERS }, (_, i) => `<span class="pip ${i < v.boosters ? 'full' : ''}"></span>`).join('');
    $('#timer').textContent = v.boosters >= MAX_BOOSTERS ? 'Stock plein' : `Prochain booster dans ${fmt(v.msToNext)}`;
  };
  draw();
  timerId = setInterval(draw, 1000);
}

// ---------- Extensions ----------
let setsCache = null;
async function renderSets() {
  view.innerHTML = `
    ${banner([ICONIC.darkMagician, ICONIC.magicianGirl], 'Extensions', 'Choisis un booster à ouvrir. Stock : ' + tick().boosters + ' / ' + MAX_BOOSTERS)}
    <div class="seg"><button class="on">TCG</button><button disabled title="À venir">OCG (bientôt)</button></div>
    <input class="search" id="q" placeholder="Rechercher une extension…" value="${esc(setFilter.q)}" autocomplete="off">
    <div class="seg" id="sort"><button data-s="new" class="${setFilter.sort === 'new' ? 'on' : ''}">Récentes</button><button data-s="old" class="${setFilter.sort === 'old' ? 'on' : ''}">Anciennes</button><button data-s="az" class="${setFilter.sort === 'az' ? 'on' : ''}">A–Z</button></div>
    <div id="list"><div class="empty"><span class="spin"></span></div></div>`;
  try {
    setsCache = setsCache || (await getSets());
  } catch (e) {
    $('#list').innerHTML = `<div class="err">Impossible de charger les extensions (${esc(e.message)}). Vérifie ta connexion puis réessaie.</div><button class="btn ghost" id="retry">Réessayer</button>`;
    $('#retry').onclick = renderSets;
    return;
  }
  const draw = () => {
    const q = setFilter.q.trim().toLowerCase();
    let l = setsCache.filter((s) => s.k >= 5 && (!q || s.n.toLowerCase().includes(q) || s.c.toLowerCase().includes(q)));
    const by = { new: (a, b) => (b.d || '').localeCompare(a.d || ''), old: (a, b) => (a.d || '9').localeCompare(b.d || '9'), az: (a, b) => a.n.localeCompare(b.n) }[setFilter.sort];
    l = l.sort(by).slice(0, 300);
    $('#list').innerHTML = l.length ? l.map((s, i) => {
      const own = S.tot[s.n] ? Object.keys(S.col).filter((k) => k.startsWith(s.n + '||')).length : 0;
      const pct = S.tot[s.n] ? Math.round((own / S.tot[s.n]) * 100) : null;
      return `<button class="setrow" data-i="${setsCache.indexOf(s)}">
        <div class="setimg"><span>${esc(s.c)}</span><img src="${esc(boosterUrl(s))}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></div>
        <div class="grow"><div class="nm">${esc(s.n)}</div><div class="meta">${s.k} cartes${s.d ? ' · ' + esc(s.d.slice(0, 4)) : ''}</div></div>
        ${pct !== null ? `<div class="pct">${pct}%</div>` : ''}</button>`;
    }).join('') : '<div class="empty">Aucune extension trouvée.</div>';
    document.querySelectorAll('.setrow').forEach((b) => (b.onclick = () => startOpen(setsCache[+b.dataset.i])));
  };
  $('#q').oninput = (e) => { setFilter.q = e.target.value; draw(); };
  $('#sort').onclick = (e) => {
    const s = e.target.dataset.s; if (!s) return;
    setFilter.sort = s;
    document.querySelectorAll('#sort button').forEach((b) => b.classList.toggle('on', b.dataset.s === s));
    draw();
  };
  startHero();
  draw();
}

// ---------- Effets : particules, éclairs, vibrations ----------
const TIER_FX = {
  0: null,
  1: { colors: ['#e8e8f4', '#ffffff'], n: 16, vib: 15 },
  2: { colors: ['#6bb8ff', '#bfe0ff', '#ffffff'], n: 34, vib: 25 },
  3: { colors: ['#ffd86b', '#fff3c4', '#ff9f1c'], n: 60, shake: 1, flash: .28, rays: 1, vib: [30, 40, 30] },
  4: { colors: ['#ff9be4', '#9be7ff', '#ffffff', '#ffd86b'], n: 95, shake: 1, flash: .4, rays: 1, ring: 1, vib: [40, 40, 60] },
  5: { colors: ['#6bffb8', '#ffffff', '#9be7ff', '#ffd86b'], n: 130, shake: 1, flash: .55, rays: 1, ring: 1, vib: [50, 40, 50, 40, 80] },
  6: { colors: ['#ff6bd6', '#ffd86b', '#6bffb8', '#6bb8ff', '#b06bff', '#ffffff'], n: 200, shake: 2, flash: .75, rays: 1, ring: 1, vib: [60, 40, 60, 40, 120] },
  7: { colors: ['#ffe38a', '#ff6bd6', '#6bffb8', '#6bb8ff', '#ffffff'], n: 280, shake: 2, flash: 1, rays: 1, ring: 1, vib: [80, 40, 80, 40, 80, 40, 200] },
};
const GLOW = { 0: '#6b6b88', 1: '#c0c0d8', 2: '#6bb8ff', 3: '#ffd86b', 4: '#ff9be4', 5: '#6bffb8', 6: '#ffffff', 7: '#ffe38a' };

const FXP = { cv: null, ctx: null, parts: [], raf: 0, d: 1 };
function fxInit() {
  if (FXP.cv) return;
  const cv = document.createElement('canvas');
  cv.className = 'fxcanvas';
  document.body.appendChild(cv);
  FXP.cv = cv; FXP.ctx = cv.getContext('2d');
  FXP.d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * FXP.d; cv.height = innerHeight * FXP.d;
}
function fxBurst(x, y, colors, n, power = 1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) n = Math.round(n / 4);
  fxInit();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 9) * power;
    FXP.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 60 + Math.random() * 50, s: 2 + Math.random() * 4, c: colors[(Math.random() * colors.length) | 0], star: Math.random() < .4 });
  }
  if (!FXP.raf) FXP.raf = requestAnimationFrame(fxLoop);
}
function fxLoop() {
  const { ctx, cv, d } = FXP;
  if (!ctx) { FXP.raf = 0; return; }
  ctx.clearRect(0, 0, cv.width, cv.height);
  FXP.parts = FXP.parts.filter((p) => p.life > 0);
  for (const p of FXP.parts) {
    p.x += p.vx; p.y += p.vy; p.vy += .14; p.vx *= .985; p.life--;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    ctx.fillStyle = p.c;
    const s = p.s * d, x = p.x * d, y = p.y * d;
    if (p.star) {
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.8); ctx.lineTo(x + s * .55, y); ctx.lineTo(x, y + s * 1.8); ctx.lineTo(x - s * .55, y); ctx.closePath();
      ctx.moveTo(x - s * 1.8, y); ctx.lineTo(x, y - s * .55); ctx.lineTo(x + s * 1.8, y); ctx.lineTo(x, y + s * .55); ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  FXP.raf = FXP.parts.length ? requestAnimationFrame(fxLoop) : 0;
  if (!FXP.parts.length) ctx.clearRect(0, 0, cv.width, cv.height);
}
function fxStop() {
  cancelAnimationFrame(FXP.raf); FXP.raf = 0; FXP.parts = [];
  if (FXP.cv) { FXP.cv.remove(); FXP.cv = null; FXP.ctx = null; }
}

// ---------- Ouverture ----------
const stageBg = () => `<div class="stage-bg"><img src="${cropUrl(ICONIC.blueEyes)}" alt="" onerror="this.remove()"></div>`;

async function startOpen(set) {
  if (tick().boosters <= 0) { toast('Plus de booster. Reviens dans quelques minutes.'); return; }
  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.innerHTML = `<div class="empty"><span class="spin"></span><br><br>Chargement de ${esc(set.n)}…</div>`;
  document.body.appendChild(stage);
  let data;
  try { data = await getSetData(set.n); }
  catch (e) {
    stage.innerHTML = `<div style="text-align:center;max-width:320px"><div class="err">Impossible de charger cette extension (${esc(e.message)}).</div><button class="btn ghost" id="cl">Fermer</button></div>`;
    $('#cl', stage).onclick = () => stage.remove();
    return;
  }
  if (!data.pool.length) { stage.remove(); toast('Cette extension ne contient aucune carte exploitable.'); return; }
  S.tot[set.n] = data.pool.length;

  const close = () => { fxStop(); stage.remove(); go(tab === 'sets' ? 'sets' : tab); };
  const face = `<img class="packimg" src="${esc(boosterUrl(set))}" alt="" onerror="this.remove()"><span class="packlabel">${esc(set.n)}</span>`;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span id="stinfo"></span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
    <button class="pack" id="pack" aria-label="Ouvrir le booster"><span class="pk bot">${face}</span><span class="pk topc">${face}</span><i class="burst"></i></button>
    <div class="hint" id="hint"><b>Touche le booster</b>pour l’ouvrir</div>`;
  $('#cl', stage).onclick = close;
  const info = () => ($('#stinfo', stage).textContent = `Boosters : ${tick().boosters} / ${MAX_BOOSTERS}`);
  info();

  let opening = false;
  $('#pack', stage).onclick = () => {
    if (opening) return;
    const next = consumeBooster(S, Date.now());
    if (!next) { toast('Plus de booster.'); return; }
    opening = true;
    S = { ...S, boosters: next.boosters, lastRefillAt: next.lastRefillAt, lastSeenAt: next.lastSeenAt, opened: S.opened + 1 };
    const pulled = openPack(data.pool, packConfigFor(set.n, set.d));
    const results = pulled.map((p) => {
      const key = set.n + '||' + p.c + '||' + p.r;
      const isNew = !S.col[key];
      S.col[key] = (S.col[key] || 0) + 1;
      return { ...p, card: data.cards[p.i], isNew };
    });
    S.hist = [...results.slice().reverse().map((x) => ({ a: x.card.a, n: x.card.n, r: x.r })), ...S.hist].slice(0, 30);
    saveState(S);
    info();
    $('#hint', stage).innerHTML = '';
    // les meilleures cartes en dernier, comme dans un vrai booster
    results.sort((a, b) => rarityInfo(a.r).tier - rarityInfo(b.r).tier);
    const pk = $('#pack', stage);
    pk.classList.add('shake');                       // 1) le paquet tremble
    setTimeout(() => {                                // 2) le haut se déchire
      pk.classList.remove('shake'); pk.classList.add('tear');
      const r = pk.getBoundingClientRect();
      fxBurst(r.left + r.width / 2, r.top + r.height * .13, ['#ffd86b', '#fff3c4', '#ffffff'], 70, 1.1);
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch {} }
    }, 650);
    setTimeout(() => revealStep(stage, set, data, results, 0, close), 1500); // 3) les cartes apparaissent
  };
}

function revealStep(stage, set, data, results, i, close) {
  if (i >= results.length) return summary(stage, set, data, results, close);
  const r = results[i];
  const meta = rarityInfo(r.r);
  const tier = meta.tier;
  const gc = GLOW[tier] || GLOW[2];
  const fx = TIER_FX[Math.min(tier, 7)];
  stage.innerHTML = `${stageBg()}
    <div class="top"><span>${i + 1} / ${results.length}</span><div class="row"><button class="skip" id="skip">Tout voir</button><button class="x" id="cl" aria-label="Fermer">✕</button></div></div>
    <div class="rays" id="rays" style="--gc:${gc}"></div>
    <div class="glow ${tier >= 2 ? 'on' : ''}" style="--gc:${gc}"></div>
    <div class="reveal ${tier >= 2 ? 'hot' : ''}" id="rv" style="--gc:${gc}">
      <div class="flipper enter" id="fl">
        <div class="face back"><i></i></div>
        <div class="face front">${cardHtml(r.card, r.r, { big: true })}</div>
      </div>
    </div>
    <div class="hint" id="hint"><b>Touche pour retourner</b>la carte</div>
    <div class="dots">${results.map((_, k) => `<i class="${k < i ? 'd' : ''}"></i>`).join('')}</div>
    <div class="flash" id="flash"></div>`;
  const rv = $('#rv', stage), fl = $('#fl', stage), hint = $('#hint', stage);
  bindTilt(rv, 16);

  const celebrate = () => {
    hint.innerHTML = `<b>${esc(meta.label)}${r.isNew ? '<span class="new">NOUVEAU</span>' : ''}</b>${esc(r.c)} · touche pour continuer`;
    if (!fx) return;
    const b = rv.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    fxBurst(cx, cy, fx.colors, fx.n, 1 + tier * .12);
    if (tier >= 5) setTimeout(() => fxBurst(cx, cy, fx.colors, Math.round(fx.n / 2), 1.5), 260);
    if (fx.flash) { const f = $('#flash', stage); f.style.setProperty('--fa', fx.flash); f.classList.add('go'); }
    if (fx.rays) $('#rays', stage).classList.add('on');
    if (fx.ring) rv.classList.add('ring-go');
    if (fx.shake) { stage.classList.add('shake' + fx.shake); setTimeout(() => stage.classList.remove('shake' + fx.shake), 750); }
    if (fx.vib && navigator.vibrate) { try { navigator.vibrate(fx.vib); } catch {} }
  };

  let flipped = false, busy = false;
  $('#cl', stage).onclick = (e) => { e.stopPropagation(); close(); };
  $('#skip', stage).onclick = (e) => { e.stopPropagation(); summary(stage, set, data, results, close); };
  stage.onclick = (e) => {
    if (e.target.closest('#cl') || e.target.closest('#skip') || busy) return;
    if (!flipped) {
      flipped = true; busy = true;
      fl.classList.add('flipped');
      setTimeout(celebrate, 330);                      // l'effet part à mi-retournement
      setTimeout(() => (busy = false), tier >= 3 ? 900 : 450);
    } else revealStep(stage, set, data, results, i + 1, close);
  };
}

function summary(stage, set, data, results, close) {
  const best = results.reduce((a, b) => (rarityInfo(b.r).tier > rarityInfo(a.r).tier ? b : a));
  stage.onclick = null;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span>${esc(set.n)}</span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
    <div class="sumgrid"><div class="grid">${results.map((x) => `<div class="slot ${rarityInfo(x.r).tier ? 't' + Math.min(7, rarityInfo(x.r).tier) : ''}">${cardHtml(x.card, x.r, { showName: false })}<div class="code">${x.isNew ? '<b style="color:var(--gold)">NEW</b> ' : ''}${esc(x.c)}</div></div>`).join('')}</div></div>
    <div class="hint"><b>${results.filter((x) => x.isNew).length} nouvelle(s) carte(s)</b>Meilleure : ${esc(best.card.n)} (${esc(rarityInfo(best.r).label)})</div>
    <div class="row" style="width:100%;max-width:520px;margin-top:10px">
      <button class="btn ghost grow" id="back">Terminer</button>
      <button class="btn grow" id="again" ${S.boosters <= 0 ? 'disabled' : ''}>Rouvrir (${S.boosters})</button>
    </div>`;
  $('#cl', stage).onclick = close;
  $('#back', stage).onclick = close;
  $('#again', stage).onclick = () => { fxStop(); stage.remove(); startOpen(set); };
}

// ---------- Collection ----------
function renderCollection() {
  const sets = Object.keys(S.tot).filter((n) => Object.keys(S.col).some((k) => k.startsWith(n + '||')));
  if (!sets.length) {
    view.innerHTML = `<h1>Collection</h1><div class="empty">Ta collection est vide.<br>Ouvre un premier booster depuis l’onglet Extensions.</div><button class="btn" id="g">Voir les extensions</button>`;
    $('#g').onclick = () => go('sets');
    return;
  }
  if (!colSet || !sets.includes(colSet)) colSet = sets[0];
  view.innerHTML = `
    ${banner([ICONIC.exodia, ICONIC.summonedSkull], 'Collection', Object.keys(S.col).length + ' cartes différentes · ' + Object.values(S.col).reduce((a, b) => a + b, 0) + ' au total')}
    <div class="chips" id="setchips">${sets.map((n) => `<button class="chip ${n === colSet ? 'on' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <div class="seg" id="own"><button data-o="all" class="${colFilter.own === 'all' ? 'on' : ''}">Toutes</button><button data-o="own" class="${colFilter.own === 'own' ? 'on' : ''}">Possédées</button><button data-o="miss" class="${colFilter.own === 'miss' ? 'on' : ''}">Manquantes</button></div>
    <div id="colbody"><div class="empty"><span class="spin"></span></div></div>`;
  $('#setchips').onclick = (e) => { const n = e.target.dataset.n; if (n) { colSet = n; colFilter.rarity = 'all'; renderCollection(); } };
  $('#own').onclick = (e) => { const o = e.target.dataset.o; if (o) { colFilter.own = o; renderCollection(); } };
  startHero();
  drawSetCollection();
}

async function drawSetCollection() {
  const body = $('#colbody');
  let data;
  try { data = await getSetData(colSet); } catch (e) { body.innerHTML = `<div class="err">Chargement impossible (${esc(e.message)}).</div>`; return; }
  const key = (p) => colSet + '||' + p.c + '||' + p.r;
  const ownN = data.pool.filter((p) => S.col[key(p)]).length;
  const rars = [...new Set(data.pool.map((p) => p.r))].sort((a, b) => rarityInfo(a).tier - rarityInfo(b).tier);
  let list = data.pool.filter((p) => (colFilter.rarity === 'all' || p.r === colFilter.rarity) &&
    (colFilter.own === 'all' || (colFilter.own === 'own') === !!S.col[key(p)]));
  body.innerHTML = `
    <div class="row" style="margin-bottom:6px"><div class="grow"><b>${ownN} / ${data.pool.length}</b> <span class="sub">complétion</span><div class="bar"><i style="width:${(ownN / data.pool.length) * 100}%"></i></div></div></div>
    <div class="chips" id="rchips"><button class="chip ${colFilter.rarity === 'all' ? 'on' : ''}" data-r="all">Toutes raretés</button>${rars.map((r) => `<button class="chip ${colFilter.rarity === r ? 'on' : ''}" data-r="${esc(r)}">${esc(rarityInfo(r).label)}</button>`).join('')}</div>
    <div class="grid" id="grid">${list.map((p, i) => {
      const q = S.col[key(p)] || 0;
      return `<button class="slot ${q ? '' : 'missing'}" data-i="${i}">
        ${q > 1 ? `<span class="qty">x${q}</span>` : ''}${cardHtml(data.cards[p.i], p.r, { showName: false, badge: !!q })}<div class="code">${esc(p.c)}</div></button>`;
    }).join('')}</div>${list.length ? '' : '<div class="empty">Aucune carte avec ce filtre.</div>'}`;
  $('#rchips').onclick = (e) => { const r = e.target.dataset.r; if (r) { colFilter.rarity = r; drawSetCollection(); } };
  document.querySelectorAll('#grid .slot').forEach((b) => (b.onclick = () => {
    const p = list[+b.dataset.i];
    openSheet(data.cards[p.i], p, S.col[key(p)] || 0);
  }));
}

function openSheet(card, p, qty) {
  const ov = $('#overlay');
  const meta = rarityInfo(p.r);
  ov.hidden = false;
  ov.innerHTML = `<div class="sheet" id="sh">
    <div id="shc">${qty ? cardHtml(card, p.r, { big: true }) : cardHtml(card, p.r, { big: true, badge: false }).replace('class="card', 'style="filter:grayscale(1) brightness(.4)" class="card')}</div>
    <div class="info"><h3>${esc(card.n)}</h3>
      <div class="kv"><span>${esc(meta.label)}</span><span>${esc(p.c)}</span><span>${qty ? 'x' + qty : 'Non possédée'}</span></div>
      <div class="kv" style="margin-top:6px"><span>${esc(card.t)}</span>${card.e ? `<span>${esc(card.e)}</span>` : ''}${card.r ? `<span>${esc(card.r)}</span>` : ''}${card.l !== null ? `<span>Niv. ${card.l}</span>` : ''}${card.k !== null ? `<span>ATK ${card.k}</span>` : ''}${card.d !== null ? `<span>DEF ${card.d}</span>` : ''}</div>
      ${card.x ? `<p class="desc">${esc(card.x)}</p>` : ''}
    </div>
    <button class="btn ghost sm" style="margin-top:14px" id="shx">Fermer</button></div>`;
  bindTilt($('#shc'), 14);
  const closeIt = () => { ov.hidden = true; ov.innerHTML = ''; };
  $('#shx').onclick = closeIt;
  $('#sh').onclick = (e) => { if (e.target.id === 'sh') closeIt(); };
}

// ---------- Profil ----------
function renderProfile() {
  const owned = Object.keys(S.col);
  const total = Object.values(S.col).reduce((a, b) => a + b, 0);
  const byTier = {};
  owned.forEach((k) => { const r = k.split('||')[2]; const t = rarityInfo(r).tier; byTier[t] = (byTier[t] || 0) + 1; });
  const rare = owned.filter((k) => rarityInfo(k.split('||')[2]).tier >= 4).length;
  view.innerHTML = `
    ${banner([ICONIC.redEyes, ICONIC.ra], 'Profil', 'Tout est enregistré sur cet appareil.')}
    <div class="stats">
      <div class="stat"><b>${S.opened}</b><span>Boosters ouverts</span></div>
      <div class="stat"><b>${total}</b><span>Cartes obtenues</span></div>
      <div class="stat"><b>${owned.length}</b><span>Cartes uniques</span></div>
      <div class="stat"><b>${rare}</b><span>Ultimate et plus</span></div>
    </div>
    <h2>Sauvegarde</h2>
    <p class="sub">Exporte ta collection pour la garder ou la transférer sur un autre appareil.</p>
    <div class="row wrap">
      <button class="btn ghost sm" id="exp">Exporter</button>
      <label class="btn ghost sm" style="cursor:pointer">Importer<input type="file" id="imp" accept=".json,application/json" hidden></label>
      <button class="btn ghost sm" id="rst" style="color:var(--danger)">Réinitialiser</button>
    </div><div id="rstbox"></div>`;
  startHero();
  $('#exp').onclick = async () => {
    const text = JSON.stringify(S);
    try {
      const f = new File([text], 'duelpacks-sauvegarde.json', { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'duelpacks-sauvegarde.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Sauvegarde exportée');
  };
  $('#imp').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { S = parseSave(await f.text()); saveState(S); toast('Sauvegarde importée'); renderProfile(); }
    catch (err) { toast(err.message || 'Fichier invalide'); }
  };
  $('#rst').onclick = () => {
    $('#rstbox').innerHTML = `<div class="err" style="margin-top:12px">Tout effacer ? Cette action est définitive.<div class="row" style="margin-top:10px"><button class="btn sm" id="yes" style="background:var(--danger);color:#fff">Oui, effacer</button><button class="btn ghost sm" id="no">Annuler</button></div></div>`;
    $('#no').onclick = () => ($('#rstbox').innerHTML = '');
    $('#yes').onclick = () => { try { localStorage.removeItem('duelpacks.save.v1'); } catch {} S = loadState(); setsCache = null; go('home'); toast('Collection réinitialisée'); };
  };
}

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'home') renderHome(); });
go('home');
