import { computeBoosters, consumeBooster, MAX_BOOSTERS, REFILL_MS, openPack, packConfigFor, packSizeFor, rarityInfo, RARITY_META } from './engine.js';
import { loadState, saveState, parseSave } from './state.js';
import * as SND from './sound.js';
import { getSets, getSetData, getSetLang, artUrl, cropUrl, boosterUrl, ICONIC } from './data.js';

let S = loadState();
let tab = 'home';
let setFilter = { q: '', sort: 'new', reg: 'EN' };
let colSet = null;
const lastRegion = {};
let colFilter = { own: 'all', rarity: 'all', sort: 'num', dir: 1, reg: null };
let timerId = null;
let heroTimer = null;

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
function cardHtml(card, rarity, { big = false, showName = true, badge = false, gem = false, fx = false, code = '' } = {}) {
  const r = rarityInfo(rarity);
  const on = fx && r.fx !== 'none';
  const im = `<img src="${artUrl(card.a)}" alt="" decoding="async">`;
  const rg = code && IMGRG[regionOf(code)];
  const frAttr = rg ? ` data-fr="${esc((card.en || card.n || '') + '|' + code + '|' + rarity)}"` : '';
  return `<div${frAttr} class="card ${big ? 'lg' : ''} ${on ? 'fxon' : ''} ${/xyz|link/i.test(card.t || '') ? 'lt' : ''} t${r.tier}" data-fx="${r.fx}">
    <img src="${artUrl(card.a)}" alt="${esc(card.n)}" loading="${big ? 'eager' : 'lazy'}" decoding="async" onerror="this.parentNode.classList.add('noimg')">
    ${on ? `<div class="fx">${im}</div><div class="fxn">${im}</div><div class="fxa">${im}</div><div class="spk"></div><div class="glare"></div>` : ''}
    ${gem && r.tier > 0 ? `<span class="gem t${Math.min(7, r.tier)}" title="${esc(r.label)}"></span>` : ''}
    ${badge && r.tier > 0 ? `<span class="gem t${Math.min(7, r.tier)}"></span>` : ''}
    ${showName ? `<div class="cname">${esc(card.n)}</div>` : '<div class="cname"></div>'}
  </div>`;
}
const EDGES = '<i class="edge l"></i><i class="edge r"></i><i class="edge t"></i><i class="edge b"></i>';
// Dos de carte : dessin d'origine, remplacé par "cardback.png" s'il est présent à côté de index.html
const backHtml = () => `<div class="cback"><div class="cb-art"></div><img class="cb-img" src="cardback.png" alt="" onerror="this.remove()"></div>`;

/** Inclinaison 3D au doigt/souris. `el` contient une `.card` ; si `.tiltwrap` existe, c'est lui qui s'incline. */
function bindTilt(el, strength = 14) {
  const card = $('.card', el) || el;
  const tgt = $('.tiltwrap', el) || card;
  const move = (x, y) => {
    const b = el.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (x - b.left) / b.width));
    const py = Math.min(1, Math.max(0, (y - b.top) / b.height));
    card.classList.add('tilting');
    card.style.setProperty('--mx', px * 100 + '%');
    card.style.setProperty('--my', py * 100 + '%');
    card.style.setProperty('--ang', Math.round(px * 360) + 'deg');
    tgt.style.transform = `rotateY(${(px - .5) * strength * 2}deg) rotateX(${(.5 - py) * strength * 2}deg)`;
  };
  const reset = () => { card.classList.remove('tilting'); tgt.style.transform = ''; card.style.setProperty('--mx', '50%'); card.style.setProperty('--my', '50%'); };
  el.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
  el.addEventListener('pointerdown', (e) => move(e.clientX, e.clientY));
  el.addEventListener('pointerleave', reset);
  el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') reset(); });
}

// ---------- Bandeaux ----------
function banner(_ids, title, sub) {
  return `<header class="hero"><div class="hero-fade"></div>
    <div class="hero-txt"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div></header>`;
}
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
  }, 5000);
}
view.addEventListener('scroll', () => view.style.setProperty('--sy', Math.min(view.scrollTop, 400) + 'px'), { passive: true });

// ---------- Navigation ----------
document.querySelectorAll('#dock button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
const BG = { home: 'blueEyes', sets: 'darkMagician', collection: 'exodia', profile: 'redEyes' };
let bgI = 0;
function setBg() {}
function go(t) {
  tab = t;
  setBg(t);
  document.querySelectorAll('#dock button').forEach((b) => b.classList.toggle('on', b.dataset.tab === (t === 'rarities' ? 'profile' : t)));
  clearInterval(timerId);
  clearInterval(heroTimer);
  view.scrollTop = 0;
  view.style.setProperty('--sy', '0px');
  ({ home: renderHome, sets: renderSets, collection: renderCollection, profile: renderProfile, rarities: renderRarities })[t]();
}

// ---------- Accueil ----------
function renderHome() {
  const lastCards = S.hist.slice(0, 14);
  view.innerHTML = `
    ${banner([ICONIC.blueEyes, ICONIC.darkMagician, ICONIC.redEyes, ICONIC.exodia, ICONIC.slifer, ICONIC.obelisk, ICONIC.ra], 'Duel Packs', 'Ouvre des boosters et complète tes extensions.')}
    <section class="panel vault">
      <div class="vhead"><span class="vlabel">Boosters</span><span class="vcount"><b id="n">0</b> / ${MAX_BOOSTERS}</span></div>
      <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><radialGradient id="bOn" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffd27a"/><stop offset=".55" stop-color="#f08a1c"/><stop offset="1" stop-color="#a84a00"/></radialGradient><radialGradient id="bOff" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#4a4a52"/><stop offset="1" stop-color="#1c1c20"/></radialGradient></defs></svg>
      <div class="stars" id="stars" aria-hidden="true"></div>
      <div class="vfoot"><span class="timer" id="timer"></span><button class="btn sm" id="go">Ouvrir un booster</button></div>
    </section>
    <h2>Ma vitrine <span class="cnt">${S.fav.length} / 9</span></h2>
    <div class="vitrine" id="vit">${Array.from({ length: 9 }, (_, k) => {
      const f = S.fav[k];
      return f ? `<button class="vslot" data-k="${k}" aria-label="${esc(f.n)}">${cardHtml({ a: f.a, n: f.n }, f.r, { showName: false, fx: true })}</button>`
        : `<button class="vslot empty" data-k="-1" aria-label="Ajouter une carte"><span>+</span></button>`;
    }).join('')}</div>
    <h2>Dernières cartes</h2>
    <div class="shelf" id="last">${lastCards.length ? '' : '<div class="empty" style="width:100%">Ta première carte apparaîtra ici.</div>'}</div>`;
  $('#go').onclick = () => go('sets');
  startHero();
  document.querySelectorAll('#vit .vslot').forEach((b) => (b.onclick = () => {
    const f = S.fav[+b.dataset.k];
    if (!f) { toast('Ouvre une carte de ta collection et touche « Ajouter à la vitrine ».'); go('collection'); return; }
    openSheet({ a: f.a, n: f.n, k: f.atk ?? null, d: f.def ?? null }, { r: f.r, c: f.c }, S.col[f.k] || 1, f.k);
  }));
  const last = $('#last');
  lastCards.forEach((h) => {
    const d = document.createElement('div');
    d.className = 'mini';
    d.innerHTML = cardHtml({ a: h.a, n: h.n }, h.r, { showName: false, gem: true });
    last.appendChild(d);
  });
  const draw = () => {
    const v = tick();
    $('#n').textContent = v.boosters;
    const p = v.boosters >= MAX_BOOSTERS ? 1 : 1 - v.msToNext / REFILL_MS;
    const STAR = '12,5.2 13.7,9.6 18.4,9.9 14.8,12.9 16,17.5 12,15 8,17.5 9.2,12.9 5.6,9.9 10.3,9.6';
    $('#stars').innerHTML = Array.from({ length: MAX_BOOSTERS }, (_, k) => {
      const f = k < v.boosters ? 1 : k === v.boosters ? p : 0;          // la bille en cours se remplit au fil des 10 minutes
      const ball = (on) => `<circle cx="12" cy="12" r="10.4" fill="url(#${on ? 'bOn' : 'bOff'})" stroke="${on ? '#7a3200' : '#3a3a42'}" stroke-width="1.3"/><circle cx="12" cy="12" r="8.4" fill="none" stroke="${on ? '#ffd9a0' : '#4a4a52'}" stroke-opacity=".5" stroke-width=".6"/><polygon points="${STAR}" fill="${on ? '#fff3cf' : '#5a5a62'}" stroke="${on ? '#b8680c' : '#2a2a30'}" stroke-width=".6" stroke-linejoin="round"/>`;
      return `<svg viewBox="0 0 24 24" class="star ${f >= 1 ? 'full' : ''}"><clipPath id="cp${k}"><rect x="0" y="0" width="${(24 * f).toFixed(2)}" height="24"/></clipPath>${ball(false)}${f > 0 ? `<g clip-path="url(#cp${k})">${ball(true)}</g>` : ''}</svg>`;
    }).join('');
    $('#timer').innerHTML = v.boosters >= MAX_BOOSTERS ? 'Stock plein' : `Prochain booster dans <b>${fmt(v.msToNext)}</b>`;
  };
  draw();
  timerId = setInterval(draw, 1000);
}

// ---------- Extensions ----------
let setsCache = null;
// produits qui ne s'ouvrent pas comme des boosters (decks préconstruits, coffrets, promos)
const NOT_BOOSTER = /structure deck|starter deck|\btins?\b|promo|demo|sneak peek|tournament|championship|gift|collector|bundle|speed duel starter|\bdeck\b.*(box|set)|duel terminal|world championship|jump|shonen|magazine|coffret/i;
async function renderSets() {
  view.innerHTML = `
    ${banner([ICONIC.darkMagician, ICONIC.magicianGirl], 'Extensions', `Choisis un booster. Il te reste <b>${tick().boosters}</b> sur ${MAX_BOOSTERS}.`)}
    <div class="seg"><button class="on">TCG</button><button disabled title="À venir">OCG, bientôt</button></div>
    <div class="chips" id="vtabs">${OPEN_REGIONS.map((r) => `<button class="chip ${setFilter.reg === r ? 'on' : ''}" data-g="${r}">${esc(REGIONS[r])}</button>`).join('')}</div>
    <input class="search" id="q" placeholder="Rechercher une extension" value="${esc(setFilter.q)}" autocomplete="off">
    <div class="seg" id="sort"><button data-s="new" class="${setFilter.sort === 'new' ? 'on' : ''}">Récentes</button><button data-s="old" class="${setFilter.sort === 'old' ? 'on' : ''}">Anciennes</button><button data-s="az" class="${setFilter.sort === 'az' ? 'on' : ''}">A à Z</button></div>
    <div id="list"><div class="empty"><span class="spin"></span></div></div>`;
  startHero();
  try {
    setsCache = setsCache || (await getSets());
  } catch (e) {
    $('#list').innerHTML = `<div class="err">Impossible de charger les extensions (${esc(e.message)}). Vérifie ta connexion puis réessaie.</div><button class="btn ghost" id="retry">Réessayer</button>`;
    $('#retry').onclick = renderSets;
    return;
  }
  const draw = () => {
    const q = setFilter.q.trim().toLowerCase();
    let l = setsCache.filter((s) => s.k >= 5 && !NOT_BOOSTER.test(s.n) && (!q || s.n.toLowerCase().includes(q) || s.c.toLowerCase().includes(q)));
    const by = { new: (a, b) => (b.d || '').localeCompare(a.d || ''), old: (a, b) => (a.d || '9').localeCompare(b.d || '9'), az: (a, b) => a.n.localeCompare(b.n) }[setFilter.sort];
    l = l.sort(by).slice(0, 300);
    $('#list').innerHTML = l.length ? `<div class="tiles">${l.map((s) => {
      const own = S.tot[s.n] ? Object.keys(S.col).filter((k) => k.startsWith(s.n + '||')).length : 0;
      const pct = S.tot[s.n] ? Math.min(100, Math.round((own / S.tot[s.n]) * 100)) : null;
      return `<button class="tile" data-i="${setsCache.indexOf(s)}">
        <div class="tile-img"><span>${esc(s.c)}</span><img data-bs="${setsCache.indexOf(s)}" alt="" decoding="async">${pct !== null ? `<i class="tile-pct">${pct}%</i>` : ''}</div>
        <div class="tile-name">${esc(s.n)}</div>
        <div class="tile-meta">${s.d ? esc(s.d.slice(0, 4)) + ' · ' : ''}${s.k} cartes · ${packSizeFor(s.n, s.k)}/booster</div></button>`;
    }).join('')}</div>` : '<div class="empty">Aucune extension trouvée.</div>';
    document.querySelectorAll('.tile').forEach((b) => (b.onclick = () => startOpen(setsCache[+b.dataset.i], setFilter.reg)));
    hydrateBoosters(document, (i) => setsCache[+i]);
  };
  $('#vtabs').onclick = (e) => { const g = e.target.closest('[data-g]'); if (!g) return; setFilter.reg = g.dataset.g; document.querySelectorAll('#vtabs .chip').forEach((c) => c.classList.toggle('on', c.dataset.g === setFilter.reg)); draw(); };
  $('#q').oninput = (e) => { setFilter.q = e.target.value; draw(); };
  $('#sort').onclick = (e) => {
    const s = e.target.dataset.s; if (!s) return;
    setFilter.sort = s;
    document.querySelectorAll('#sort button').forEach((b) => b.classList.toggle('on', b.dataset.s === s));
    draw();
  };
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
  if (reduced()) n = Math.round(n / 4);
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
const stageBg = () => '<div class="stage-bg"></div>';

async function startOpen(set, region) {
  if (tick().boosters <= 0) { toast('Plus de booster. Reviens dans quelques minutes.'); return; }
  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.innerHTML = `<div class="empty"><span class="spin"></span><br><br>Chargement de ${esc(set.n)}</div>`;
  document.body.appendChild(stage);
  let data;
  try { data = await getSetData(set.n); }
  catch (e) {
    stage.innerHTML = `<div style="text-align:center;max-width:320px"><div class="err">Impossible de charger cette extension (${esc(e.message)}).</div><button class="btn ghost" id="cl">Fermer</button></div>`;
    $('#cl', stage).onclick = () => stage.remove();
    return;
  }
  if (!data.pool.length) { stage.remove(); toast('Cette extension ne contient aucune carte exploitable.'); return; }
  S.tot[set.n] = mainPool(data.pool).length;
  const regs = regionList(data.pool);
  if (region && !regs.includes(region)) { stage.remove(); toast(`${set.n} n’existe pas en version ${REGIONS[region] || region}.`); return; }
  if (!region && regs.length === 1) region = regs[0];
  if (!region) {
    const last = lastRegion[set.n];
    stage.innerHTML = `${stageBg()}<div class="top"><span>${esc(set.n)}</span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
      <div class="vchoose"><h3>Choisis la version</h3><p>Chaque version contient les cartes et les numéros de sa région.</p>
      ${regs.map((r) => `<button class="btn ${r === last ? '' : 'ghost'} vbtn" data-g="${esc(r)}"><b>${esc(REGIONS[r] || r)}</b><small>${data.pool.filter((p) => regionOf(p.c) === r).length} cartes · ${esc(r)}</small></button>`).join('')}</div>`;
    $('#cl', stage).onclick = () => stage.remove();
    stage.querySelectorAll('.vbtn').forEach((b) => (b.onclick = () => { stage.remove(); startOpen(set, b.dataset.g); }));
    return;
  }
  lastRegion[set.n] = region;
  const cards = await localize(set.n, data.cards, region);
  const regPool = data.pool.filter((p) => regionOf(p.c) === region);

  const close = () => { fxStop(); stage.remove(); go(tab === 'sets' ? 'sets' : tab); };
  const face = `<img class="packimg" data-bs="0" alt=""><img class="packsheen" data-bs="0" alt=""><span class="packlabel">${esc(set.n)}<br><small>${esc(REGIONS[region] || region)}</small></span>`;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span id="stinfo"></span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
    <div class="packstage" id="pstage"><div class="pack3d" id="p3d">
      <button class="pack" id="pack" aria-label="Ouvrir le booster"><span class="pk side l"></span><span class="pk side r"></span><span class="pk back"></span>${[1, 2, 3, 4, 5].map((k) => `<span class="pk slice" style="--k:${k}"></span>`).join('')}<span class="pk bot">${face}</span><span class="pk topc">${face}</span><i class="tearguide"></i><i class="tearline"></i><i class="burst"></i></button>
      <div class="pglare"></div></div></div>
    <div class="pfloor"></div>
    <div class="hint" id="hint"><b>Déchire le booster</b>glisse le doigt le long du haut</div>`;
  // le booster épouse le format réel de l'image
  const fi = $('.pk.bot .packimg', stage);
  const fit = () => { if (fi && fi.naturalWidth) $('#pack', stage).style.setProperty('--ar', Math.min(.95, Math.max(.42, fi.naturalWidth / fi.naturalHeight)).toFixed(3)); };
  if (fi) fi.addEventListener('load', fit);
  hydrateBoosters(stage, () => set);
  $('#cl', stage).onclick = close;
  const info = () => ($('#stinfo', stage).textContent = `${tick().boosters} / ${MAX_BOOSTERS} boosters`);
  info();

  // inclinaison 3D du booster
  const p3d = $('#p3d', stage), pst = $('#pstage', stage);
  let opening = false;
  const tiltPack = (e) => {
    if (opening || tearing) return;
    const b = pst.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), py = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    p3d.style.transform = `rotateY(${(px - .5) * 56}deg) rotateX(${(.5 - py) * 36}deg)`;
    p3d.style.setProperty('--gx', px * 100 + '%'); p3d.style.setProperty('--gy', py * 100 + '%');
    $('.pglare', p3d).style.setProperty('--gx', px * 100 + '%'); $('.pglare', p3d).style.setProperty('--gy', py * 100 + '%');
  };
  stage.addEventListener('pointermove', tiltPack);
  stage.addEventListener('pointerdown', tiltPack);

  // ---- Ouverture : on glisse le doigt le long du trait de découpe, en haut du booster ----
  const pk = $('#pack', stage);
  let tearing = false, tx0 = 0, tid = null, lastTick = 0;
  const setTear = (p, s) => { pk.style.setProperty('--tp', p.toFixed(3)); pk.style.setProperty('--ts', s); };
  const doOpen = (dir) => {
    if (opening) return;
    const next = consumeBooster(S, Date.now());
    if (!next) { toast('Plus de booster.'); setTear(0, 1); return; }
    opening = true; SND.dragStop(); SND.rip(); setTimeout(SND.whoosh, 260);
    p3d.style.transform = '';
    pk.style.setProperty('--ts', dir);
    pk.classList.remove('dragging');
    S = { ...S, boosters: next.boosters, lastRefillAt: next.lastRefillAt, lastSeenAt: next.lastSeenAt, opened: S.opened + 1 };
    const mp = regPool;
    const pulled = openPack(mp, packConfigFor(set.n, set.d, mp.length));
    const results = pulled.map((p) => {
      const key = set.n + '||' + p.c + '||' + p.r;
      const isNew = !S.col[key];
      S.col[key] = (S.col[key] || 0) + 1;
      return { ...p, card: cards[p.i], isNew, n: S.col[key] };
    });
    S.hist = [...results.slice().reverse().map((x) => ({ a: x.card.a, n: x.card.n, r: x.r })), ...S.hist].slice(0, 30);
    saveState(S);
    info();
    $('#hint', stage).innerHTML = '';
    // les meilleures cartes en dernier, comme dans un vrai booster
    results.sort((a, b) => rarityInfo(a.r).tier - rarityInfo(b.r).tier);
    results.forEach((x) => { const im = new Image(); im.decoding = 'async'; im.src = artUrl(x.card.a); });   // préchargement
    pk.classList.add('tear');                         // le haut est arraché dans le sens du geste
    p3d.classList.add('snap');                        // le sachet encaisse le coup
    stage.classList.add('shake1'); setTimeout(() => stage.classList.remove('shake1'), 500);
    const r = pk.getBoundingClientRect(), y0 = r.top + r.height * .13;
    // étincelles et lamelles de foil tout le long de la déchirure, de l'amorce vers la fin
    for (let k = 0; k < 6; k++) setTimeout(() => {
      const x = dir > 0 ? r.left + r.width * (k / 5) : r.right - r.width * (k / 5);
      fxBurst(x, y0, ['#ffd86b', '#fff3c4', '#ffffff', '#c8ccd6'], 22, 1.1);
    }, k * 35);
    const fl = document.createElement('div'); fl.className = 'tearflash'; stage.appendChild(fl); setTimeout(() => fl.remove(), 400);
    if (navigator.vibrate) { try { navigator.vibrate([15, 20, 30, 20, 50]); } catch {} }
    setTimeout(() => stage.classList.add('packout'), 520);                  // le sachet vide s'enfonce et s'efface
    setTimeout(() => revealStep(stage, set, data, results, 0, close), 860);   // la première carte monte à sa place
  };
  pk.addEventListener('pointerdown', (e) => {
    if (opening) return;
    const b = pk.getBoundingClientRect();
    if ((e.clientY - b.top) / b.height > .34) return;        // le geste commence dans la partie haute
    SND.unlock(); SND.dragStart();
    tearing = true; tx0 = e.clientX; tid = e.pointerId;
    try { pk.setPointerCapture(tid); } catch {}
    pk.classList.add('dragging');
    e.stopPropagation();
  });
  pk.addEventListener('pointermove', (e) => {
    if (!tearing || e.pointerId !== tid) return;
    const b = pk.getBoundingClientRect();
    const dx = e.clientX - tx0, p = Math.min(1, Math.abs(dx) / (b.width * .85));
    const s = dx >= 0 ? 1 : -1;
    setTear(p, s); SND.dragSet(p);
    const stepNo = Math.floor(p * 6);
    if (stepNo !== lastTick) { lastTick = stepNo; if (navigator.vibrate) { try { navigator.vibrate(6); } catch {} } }
    if (p >= 1) { tearing = false; doOpen(s); }
  });
  const end = () => {
    if (!tearing) return;
    tearing = false; lastTick = 0; SND.dragStop();
    pk.classList.remove('dragging');                          // relâché trop tôt : le haut se repose
    setTear(0, +pk.style.getPropertyValue('--ts') || 1);
  };
  pk.addEventListener('pointerup', end);
  pk.addEventListener('pointercancel', end);
  pk.addEventListener('click', (e) => {                       // simple toucher : indice ; clavier : ouvre
    if (opening) return;
    if (e.detail === 0) { doOpen(1); return; }
    pk.classList.remove('nudge'); void pk.offsetWidth; pk.classList.add('nudge');
  });
}

function revealStep(stage, set, data, results, i, close) {
  if (i >= results.length) return summary(stage, set, data, results, close);
  const r = results[i];
  const meta = rarityInfo(r.r);
  const tier = meta.tier;
  const gc = GLOW[tier] || GLOW[2];
  const fx = TIER_FX[Math.min(tier, 7)];
  // Le décor (fond flouté, boutons, points) est créé une seule fois : seule la carte est remplacée,
  // ce qui évite de recharger et recalculer le fond à chaque carte.
  if (!stage.dataset.rv) {
    stage.dataset.rv = '1';
    stage.classList.remove('packout');
    stage.innerHTML = `${stageBg()}
      <div class="top"><span id="cnt"></span><div class="row"><button class="skip" id="skip">Tout voir</button><button class="x" id="cl" aria-label="Fermer">✕</button></div></div>
      <div id="rbox"></div>
      <div class="hint" id="hint"></div>
      <div class="dots" id="dots">${results.map(() => '<i></i>').join('')}</div>
      <div class="flash" id="flash"></div>`;
    $('#cl', stage).onclick = (e) => { e.stopPropagation(); close(); };
    $('#skip', stage).onclick = (e) => { e.stopPropagation(); cur.skip = true; summary(stage, set, data, results, close); };
  }
  const cur = (stage._cur = { skip: false });
  SND.card(tier);
  $('#cnt', stage).textContent = `${i + 1} / ${results.length}`;
  [...$('#dots', stage).children].forEach((d, k) => d.classList.toggle('d', k < i));
  $('#rbox', stage).innerHTML = `
    <div class="rays" id="rays" style="--gc:${gc}"></div>
    <div class="glow ${tier >= 2 ? 'on' : ''}" style="--gc:${gc}"></div>
    <div class="reveal ${tier >= 2 ? 'hot' : ''}" id="rv" style="--gc:${gc}">
      <div class="tiltwrap"><div class="flipper enter ${i === 0 ? 'first' : ''}" id="fl">
        <div class="face front">${cardHtml(r.card, r.r, { big: true, fx: true, code: r.c })}</div>
      </div></div>
    </div>`;
  const rv = $('#rv', stage), hint = $('#hint', stage);
  bindTilt(rv, 16);
  // nom, rareté et code visibles dès l'apparition de la carte
  hint.innerHTML = `<div class="rarbadge t${Math.min(7, tier)}" data-fx="${meta.fx}" style="--gc:${gc}">${esc(meta.label)}</div><span class="cardname">${esc(r.card.n)}${r.isNew ? '<span class="new">Nouveau</span>' : `<span class="new dbl">Double ×${r.n}</span>`}</span><span class="cardsub">${esc(r.c)}</span>`;

  const celebrate = () => {
    if (!fx || cur.skip) return;
    const b = rv.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    fxBurst(cx, cy, fx.colors, fx.n, 1 + tier * .12);
    if (tier >= 5) setTimeout(() => fxBurst(cx, cy, fx.colors, Math.round(fx.n / 2), 1.5), 260);
    if (fx.flash) { const f = $('#flash', stage); f.classList.remove('go'); void f.offsetWidth; f.style.setProperty('--fa', fx.flash); f.classList.add('go'); }
    if (fx.rays) $('#rays', stage).classList.add('on');
    if (fx.ring) rv.classList.add('ring-go');
    if (fx.shake) { stage.classList.add('shake' + fx.shake); setTimeout(() => stage.classList.remove('shake' + fx.shake), 750); }
    if (fx.vib && navigator.vibrate) { try { navigator.vibrate(fx.vib); } catch {} }
  };

  let busy = true;                                      // bref délai pendant que la carte se pose
  setTimeout(() => { if (stage._cur !== cur) return; celebrate(); busy = false; }, reduced() ? 10 : (tier >= 3 ? 320 : 180));
  const next = () => {
    if (busy) return;
    busy = true;
    rv.classList.add('out');                            // la carte part vers le haut, comme on la retire du paquet
    setTimeout(() => { if (stage._cur === cur) revealStep(stage, set, data, results, i + 1, close); }, reduced() ? 10 : 330);
  };
  let sy = null, swiped = false;
  stage.onpointerdown = (e) => { sy = e.clientY; swiped = false; };
  stage.onpointerup = (e) => {
    if (sy !== null && !busy && sy - e.clientY > 50) { swiped = true; next(); }
    sy = null;
  };
  stage.onclick = (e) => {
    if (e.target.closest('#cl') || e.target.closest('#skip') || busy || swiped) { swiped = false; return; }
    next();
  };
}

function summary(stage, set, data, results, close) {
  const best = results.reduce((a, b) => (rarityInfo(b.r).tier > rarityInfo(a.r).tier ? b : a));
  stage.onclick = null;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span>${esc(set.n)}</span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
    <div class="sumgrid"><div class="grid">${results.map((x) => `<div class="slot ${rarityInfo(x.r).tier ? 't' + Math.min(7, rarityInfo(x.r).tier) : ''}">${cardHtml(x.card, x.r, { showName: false, gem: true, fx: true, code: x.c })}<div class="code">${x.isNew ? '<b style="color:var(--brass-hi)">Nouveau</b> · ' : `<b style="color:#c9ced8">Double ×${x.n}</b> · `}${esc(x.c)}</div></div>`).join('')}</div></div>
    <div class="hint" style="margin-top:18px"><b>${results.filter((x) => x.isNew).length} nouvelle(s) carte(s), ${results.filter((x) => !x.isNew).length} double(s)</b>Meilleure : ${esc(best.card.n)} (${esc(rarityInfo(best.r).label)})</div>
    <div class="row" style="width:100%;max-width:540px;margin-top:8px">
      <button class="btn ghost grow" id="back">Terminer</button>
      <button class="btn grow" id="again" ${S.boosters <= 0 ? 'disabled' : ''}>Rouvrir (${S.boosters})</button>
    </div>`;
  $('#cl', stage).onclick = close;
  $('#back', stage).onclick = close;
  $('#again', stage).onclick = () => { fxStop(); stage.remove(); startOpen(set, region); };
}


// ---------- Images de boosters : fond blanc retiré proprement (remplissage depuis les bords, sans liseré) ----------
const bsCache = new Map();
const loadImg = (src, cors) => new Promise((res, rej) => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
function cleanBg(im) {
  const sc = Math.min(1, 460 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, w, h);
  const id = cx.getImageData(0, 0, w, h), d = id.data;
  const bg = new Uint8Array(w * h), st = [];
  const isW = (p) => { const o = p * 4; if (d[o + 3] < 16) return true; const mn = Math.min(d[o], d[o + 1], d[o + 2]), mx = Math.max(d[o], d[o + 1], d[o + 2]); return mn >= 226 && mx - mn < 28; };
  const push = (p) => { if (!bg[p] && isW(p)) { bg[p] = 1; st.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) { const p = st.pop(), x = p % w; if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < w * (h - 1)) push(p + w); }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, o = p * 4;
    if (bg[p]) { d[o + 3] = 0; continue; }
    const edge = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w]);
    if (edge) {
      const mn = Math.min(d[o], d[o + 1], d[o + 2]);
      const a = Math.max(0, Math.min(1, 1 - (mn - 170) / 85));
      if (a < 1) { for (let c = 0; c < 3; c++) d[o + c] = Math.max(0, Math.min(255, (d[o + c] - 255 * (1 - a)) / Math.max(a, .05))); d[o + 3] = Math.round(a * d[o + 3]); }
    }
    if (d[o + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error('vide');
  cx.putImageData(id, 0, 0);
  const o2 = document.createElement('canvas'); o2.width = x1 - x0 + 1; o2.height = y1 - y0 + 1;
  o2.getContext('2d').drawImage(cv, x0, y0, o2.width, o2.height, 0, 0, o2.width, o2.height);
  return o2.toDataURL('image/png');
}
function boosterSrc(set) {
  if (bsCache.has(set.c)) return bsCache.get(set.c);
  const yp = `https://yugipedia.com/wiki/Special:FilePath/${encodeURIComponent(set.c)}-BoosterEN.png?width=480`;
  const p = (async () => {
    for (const u of [yp, boosterUrl(set)]) {
      try { return cleanBg(await loadImg(u, true)); } catch (e) { /* CORS ou image absente */ }
      try { await loadImg(u, false); return u; } catch (e) { /* image absente */ }
    }
    return null;
  })();
  bsCache.set(set.c, p);
  return p;
}
function hydrateBoosters(root, getSet) {
  root.querySelectorAll('img[data-bs]').forEach((img) => {
    const set = getSet(img.dataset.bs);
    boosterSrc(set).then((u) => {
      if (u) { img.src = u; return; }
      img.remove();
      const pk = document.querySelector('.pack'); if (pk && !pk.querySelector('.packimg')) pk.classList.add('noimg');
    });
  });
}



// ---------- Visuels de cartes dans la langue de la version (Yugipedia), repli sur l'image anglaise ----------
const IMGRG = { FR: 'FR', F: 'FR', DE: 'DE', G: 'DE', IT: 'IT', I: 'IT', PT: 'PT', P: 'PT', SP: 'SP', S: 'SP' };
const RAR_ABBR = { common: ['C'], short_print: ['SP', 'C'], rare: ['R'], super_rare: ['SR'], ultra_rare: ['UR'], secret_rare: ['ScR'], ultimate_rare: ['UtR'], ghost_rare: ['GR'], gold_rare: ['GUR'], platinum_rare: ['PlR'], parallel_rare: ['PR'], starlight_rare: ['StR'], mosaic_rare: ['MSR'], shatterfoil: ['SFR'], starfoil: ['SF'], premium_gold: ['PGR'], gold_secret: ['GScR'], collectors_rare: ['CR'], prismatic_secret_rare: ['PScR'], ultra_secret_rare: ['UScR'] };
const frMem = new Map();
let frActive = 0; const frQueue = [];
const frRun = () => { while (frActive < 3 && frQueue.length) { const f = frQueue.shift(); frActive++; f().finally(() => { frActive--; frRun(); }); } };
function frArt(en, code, rar) {
  const k = en + '|' + code + '|' + rar;
  if (frMem.has(k)) return frMem.get(k);
  const pr = new Promise((res) => frQueue.push(async () => {
    try {
      const name = en.replace(/[^A-Za-z0-9]/g, ''), set = code.split('-')[0], rg = IMGRG[regionOf(code)];
      const j = await (await fetch(`${YPI}&ailimit=60&aiprefix=${encodeURIComponent(name + '-' + set + '-' + rg + '-')}`)).json();
      const list = (j.query?.allimages || []).map((im) => ({ n: String(im.name).replace(/_/g, ' ').replace(/ /g, ''), url: im.url }))
        .filter((x) => /\.(png|jpe?g)$/i.test(x.n) && !/-(OP|OW|Reprint)\./i.test(x.n));
      const abbr = (RAR_ABBR[rar] || []).map((s) => s.toLowerCase());
      const part = (x) => x.n.slice((name + '-' + set + '-' + rg + '-').length).replace(/\.[a-z]+$/i, '').toLowerCase().split('-');
      const best = list.find((x) => abbr.includes(part(x)[0]) && /^(1e|ue|)$/.test(part(x)[1] || '')) || list.find((x) => abbr.includes(part(x)[0])) || list.find((x) => part(x)[0] === 'c') || list[0];
      res(best ? best.url : null);
    } catch (e) { res(null); }
  }));
  frMem.set(k, pr); frRun();
  return pr;
}
function hydrateFr(root) {
  root.querySelectorAll('.card[data-fr]:not([data-frd])').forEach((c) => {
    c.dataset.frd = '1';
    const [en, code, rar] = c.dataset.fr.split('|');
    if (!en) return;
    frArt(en, code, rar).then((u) => { if (u) c.querySelectorAll('img').forEach((im) => { im.src = u; }); });
  });
}
new MutationObserver(() => hydrateFr(document)).observe(document.body, { childList: true, subtree: true });

// ---------- Versions régionales d'une carte (EN = Amérique, E/EU = Europe, FR, DE...) ----------
const REGIONS = { EN: 'Américaine', EU: 'Anglaise (Royaume-Uni)', AE: 'Asie (EN)', FR: 'France', DE: 'Allemagne', IT: 'Italie', SP: 'Espagne', PT: 'Portugal', JP: 'Japon', KR: 'Corée', SC: 'Chine', TC: 'Taïwan', AU: 'Australie' };
const OPEN_REGIONS = ['EN', 'EU', 'FR', 'DE', 'IT', 'SP', 'PT'];
const REGION_ORDER = ['EN', 'EU', 'AE', 'AU', 'FR', 'DE', 'IT', 'SP', 'PT', 'JP', 'KR', 'SC', 'TC'];
const CANON = { NA: 'EN', E: 'EU', F: 'FR', G: 'DE', I: 'IT', S: 'SP', P: 'PT', J: 'JP', K: 'KR' };
const regionOf = (code) => { const m = /-([A-Z]+)\d/.exec(code || ''); const r = m ? m[1] : (/-\d/.test(code || '') ? 'FR' : 'EN'); return CANON[r] || r; };
const regionList = (pool) => [...new Set(pool.map((p) => regionOf(p.c)))].sort((a, b) => { const ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
const LANGS = { FR: 'fr', F: 'fr', DE: 'de', G: 'de', IT: 'it', I: 'it', PT: 'pt', P: 'pt' };
const localize = async (setName, cards, region) => {
  const lg = LANGS[region]; if (!lg) return cards;
  const L = await getSetLang(setName, lg); if (!Object.keys(L).length) return cards;
  const o = {}; for (const id in cards) o[id] = L[id] ? { ...cards[id], en: cards[id].en || cards[id].n, n: L[id].n, x: L[id].x || cards[id].x } : cards[id];
  return o;
};
const mainPool = (pool) => { const r = regionList(pool)[0]; return pool.filter((p) => regionOf(p.c) === r); };

// ---------- Collection ----------
function renderCollection() {
  const sets = Object.keys(S.tot).filter((n) => Object.keys(S.col).some((k) => k.startsWith(n + '||')));
  const uniq = Object.keys(S.col).length, total = Object.values(S.col).reduce((a, b) => a + b, 0);
  if (!sets.length) {
    view.innerHTML = `${banner([ICONIC.exodia, ICONIC.summonedSkull], 'Collection', 'Ta vitrine est vide pour l’instant.')}
      <div class="empty">Ouvre un premier booster depuis l’onglet Extensions.</div><button class="btn" id="g">Voir les extensions</button>`;
    $('#g').onclick = () => go('sets');
    startHero();
    return;
  }
  if (!colSet || (colSet !== '*' && !sets.includes(colSet))) colSet = sets[0];
  view.innerHTML = `
    ${banner([ICONIC.exodia, ICONIC.summonedSkull], 'Collection', `${uniq} cartes différentes, ${total} au total.`)}
    <div class="chips" id="setchips"><button class="chip ${colSet === '*' ? 'on' : ''}" data-n="*">Tout</button>${sets.map((n) => `<button class="chip ${n === colSet ? 'on' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <div class="seg" id="own"><button data-o="all" class="${colFilter.own === 'all' ? 'on' : ''}">Toutes</button><button data-o="own" class="${colFilter.own === 'own' ? 'on' : ''}">Possédées</button><button data-o="miss" class="${colFilter.own === 'miss' ? 'on' : ''}">Manquantes</button><button data-o="dup" class="${colFilter.own === 'dup' ? 'on' : ''}">Doubles</button></div>
    <div class="sortbar"><label>Trier par</label><select id="csort">${[['num', 'Numéro'], ['rar', 'Rareté'], ['name', 'Nom'], ['atk', 'ATK'], ['def', 'DEF'], ['lvl', 'Niveau'], ['type', 'Type'], ['attr', 'Attribut'], ['qty', 'Quantité'], ['set', 'Extension']].map(([v, l]) => `<option value="${v}" ${colFilter.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="chip" id="cdir" aria-label="Sens du tri">${colFilter.dir > 0 ? '↑ Croissant' : '↓ Décroissant'}</button></div>
    <div id="colbody"><div class="empty"><span class="spin"></span></div></div>`;
  startHero();
  $('#setchips').onclick = (e) => { const n = e.target.dataset.n; if (n) { colSet = n; colFilter.rarity = 'all'; renderCollection(); } };
  $('#own').onclick = (e) => { const o = e.target.dataset.o; if (o) { colFilter.own = o; renderCollection(); } };
  $('#csort').onchange = (e) => { colFilter.sort = e.target.value; drawSetCollection(); };
  $('#cdir').onclick = (e) => { colFilter.dir = -colFilter.dir; e.target.textContent = colFilter.dir > 0 ? '↑ Croissant' : '↓ Décroissant'; drawSetCollection(); };
  drawSetCollection();
}

async function drawSetCollection() {
  const body = $('#colbody');
  const all = colSet === '*';
  const names = all ? Object.keys(S.tot).filter((n) => Object.keys(S.col).some((k) => k.startsWith(n + '||'))) : [colSet];
  let datas;
  try { datas = await Promise.all(names.map(async (n) => [n, await getSetData(n)])); } catch (e) { body.innerHTML = `<div class="err">Chargement impossible (${esc(e.message)}).</div>`; return; }
  let ent = [];
  for (const [n, data] of datas) for (const p of data.pool) ent.push({ n, p, card: data.cards[p.i], k: n + '||' + p.c + '||' + p.r });
  const qOf = (e) => S.col[e.k] || 0;
  const regs = regionList(ent.map((e) => e.p));
  if (!regs.includes(colFilter.reg)) colFilter.reg = regs[0];
  const entAll = ent;
  const regOwn = (r) => entAll.filter((e) => regionOf(e.p.c) === r && qOf(e)).length;
  ent = ent.filter((e) => regionOf(e.p.c) === colFilter.reg);
  if (LANGS[colFilter.reg]) {
    const dm = Object.fromEntries(datas), loc = {};
    await Promise.all([...new Set(ent.map((e) => e.n))].map(async (n) => { loc[n] = await localize(n, dm[n].cards, colFilter.reg); }));
    ent = ent.map((e) => ({ ...e, card: loc[e.n][e.p.i] || e.card }));
  }
  const ownN = ent.filter((e) => qOf(e)).length;
  const rars = [...new Set(ent.map((e) => e.p.r))].sort((a, b) => rarityInfo(a).tier - rarityInfo(b).tier);
  let list = ent.filter((e) => (colFilter.rarity === 'all' || e.p.r === colFilter.rarity) &&
    (all ? qOf(e) > 0 : true) &&
    (colFilter.own === 'all' || (colFilter.own === 'own' && qOf(e) > 0) || (colFilter.own === 'miss' && !qOf(e)) || (colFilter.own === 'dup' && qOf(e) > 1)));
  const num = (v) => (v === null || v === undefined || v === '' ? null : +v);
  const cmpNum = (x, y) => (x === null ? (y === null ? 0 : 1) : y === null ? -1 : x - y);
  const cmp = {
    num: (a, b) => a.p.c.localeCompare(b.p.c, 'en', { numeric: true }),
    rar: (a, b) => rarityInfo(a.p.r).tier - rarityInfo(b.p.r).tier,
    name: (a, b) => a.card.n.localeCompare(b.card.n),
    atk: (a, b) => cmpNum(num(a.card.k), num(b.card.k)),
    def: (a, b) => cmpNum(num(a.card.d), num(b.card.d)),
    lvl: (a, b) => cmpNum(num(a.card.l), num(b.card.l)),
    type: (a, b) => (a.card.t || '').localeCompare(b.card.t || '') || (a.card.r || '').localeCompare(b.card.r || ''),
    attr: (a, b) => (a.card.e || 'zzz').localeCompare(b.card.e || 'zzz'),
    qty: (a, b) => qOf(a) - qOf(b),
    set: (a, b) => a.n.localeCompare(b.n),
  }[colFilter.sort] || (() => 0);
  list = list.map((e, i) => [e, i]).sort((x, y) => (cmp(x[0], y[0]) * colFilter.dir) || x[1] - y[1]).map((x) => x[0]);
  const dups = ent.filter((e) => qOf(e) > 1).reduce((s, e) => s + qOf(e) - 1, 0);
  body.innerHTML = `
    <div class="compl"><b>${all ? ownN + ' cartes' : ownN + ' / ' + ent.length}</b><span>${all ? 'toutes extensions · ' : 'cartes de l’extension · '}${dups} double${dups > 1 ? 's' : ''}</span></div>
    <div class="bar" style="margin-bottom:14px"><i style="width:${all ? 100 : (ownN / Math.max(1, ent.length)) * 100}%"></i></div>
    ${regs.length > 1 ? `<div class="chips" id="regchips">${regs.map((r) => `<button class="chip ${colFilter.reg === r ? 'on' : ''}" data-g="${esc(r)}">${esc(REGIONS[r] || r)} <small>${regOwn(r)}</small></button>`).join('')}</div>` : ''}
    <div class="chips" id="rchips"><button class="chip ${colFilter.rarity === 'all' ? 'on' : ''}" data-r="all">Toutes raretés</button>${rars.map((r) => `<button class="chip ${colFilter.rarity === r ? 'on' : ''}" data-r="${esc(r)}">${esc(rarityInfo(r).label)}</button>`).join('')}</div>
    <div class="grid" id="grid">${list.map((e, i) => {
      const q = qOf(e);
      return `<button class="slot ${q ? '' : 'missing'}" data-i="${i}" aria-label="${esc(e.card.n)}">
        ${q > 1 ? `<span class="qty">x${q}</span>` : ''}${cardHtml(e.card, e.p.r, { showName: false, gem: !!q, code: e.p.c })}<div class="code">${esc(e.p.c)}</div></button>`;
    }).join('')}</div>${list.length ? '' : '<div class="empty">Aucune carte avec ce filtre.</div>'}`;
  const rg = $('#regchips'); if (rg) rg.onclick = (ev) => { const g = ev.target.closest('[data-g]'); if (g) { colFilter.reg = g.dataset.g; colFilter.rarity = 'all'; drawSetCollection(); } };
  $('#rchips').onclick = (ev) => { const r = ev.target.dataset.r; if (r) { colFilter.rarity = r; drawSetCollection(); } };
  document.querySelectorAll('#grid .slot').forEach((b) => (b.onclick = () => {
    const e = list[+b.dataset.i];
    openSheet(e.card, e.p, qOf(e), e.k);
  }));
}

// ---------- Fiche carte : objet 3D à faire tourner ----------
function bindSpin(box, body, card0, onStop) {
  let card = card0;
  const st = { rx: 0, ry: 0, vx: 0, vy: 0, down: false, lx: 0, ly: 0, raf: 0, settling: false };
  const apply = () => {
    body.style.transform = `rotateX(${st.rx.toFixed(2)}deg) rotateY(${st.ry.toFixed(2)}deg)`;
    const a = (st.ry * Math.PI) / 180;
    card.style.setProperty('--mx', (50 + 42 * Math.sin(a)).toFixed(1) + '%');
    card.style.setProperty('--my', (50 - st.rx * .9).toFixed(1) + '%');
    card.style.setProperty('--ang', ((st.ry % 360) + 360) % 360 + 'deg');
    const fl = box.nextElementSibling;
    if (fl) fl.style.transform = `scaleX(${(.55 + .45 * Math.abs(Math.cos(a))).toFixed(2)})`;
  };
  const loop = () => {
    if (!st.down) {
      st.ry += st.vy; st.rx += st.vx; st.vy *= .94; st.vx *= .94;
      if (Math.abs(st.vy) < .35 && Math.abs(st.vx) < .35) st.settling = true;
      if (st.settling) {                                  // la carte revient à plat, face ou dos
        const ty = Math.round(st.ry / 180) * 180;
        st.ry += (ty - st.ry) * .12; st.rx += (0 - st.rx) * .12;
        if (Math.abs(ty - st.ry) < .15 && Math.abs(st.rx) < .15) {
          st.ry = ty; st.rx = 0; apply(); card.classList.remove('tilting'); st.raf = 0; return;
        }
      }
    }
    st.rx = Math.max(-70, Math.min(70, st.rx));
    apply();
    st.raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!st.raf) st.raf = requestAnimationFrame(loop); };
  box.addEventListener('pointerdown', (e) => {
    st.down = true; st.settling = false; st.lx = e.clientX; st.ly = e.clientY; st.vx = st.vy = 0;
    card.classList.add('tilting');
    try { box.setPointerCapture(e.pointerId); } catch {}
    kick();
  });
  box.addEventListener('pointermove', (e) => {
    if (!st.down) return;
    const dx = e.clientX - st.lx, dy = e.clientY - st.ly;
    st.lx = e.clientX; st.ly = e.clientY;
    st.ry += dx * .55; st.rx -= dy * .4;
    st.vy = dx * .55; st.vx = -dy * .4;
  });
  const up = () => { st.down = false; kick(); };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  let lastTap = 0;
  box.addEventListener('dblclick', () => flipTo(180));
  box.addEventListener('pointerdown', () => { const n = Date.now(); if (n - lastTap < 280) flipTo(180); lastTap = n; });
  function flipTo(deg) { st.vy = deg > 0 ? 22 : -22; st.settling = false; card.classList.add('tilting'); kick(); }
  return {
    reset() { st.vy = 0; st.vx = 0; st.settling = true; st.ry = Math.round(st.ry / 360) * 360; card.classList.add('tilting'); kick(); },
    flip() { flipTo(180); },
    setCard(c) { card = c; },
    stop() { cancelAnimationFrame(st.raf); st.raf = 0; },
  };
}

// ---------- Version anime (images de Yugipedia, trouvées à la demande) ----------
// Les fichiers sont nommés "NomDeLaCarte-JP|AE|EN-Anime-SERIE.png" (DM, GX, 5D, ZX, AV, VR, SV).
const ANIME_SERIES = { DM: 'Duel Monsters', GX: 'GX', '5D': '5D’s', ZX: 'ZEXAL', AV: 'ARC-V', VR: 'VRAINS', SV: 'SEVENS' };
const animeMem = new Map();
let animeBackMem = null;
const YPI = 'https://yugipedia.com/api.php?action=query&list=allimages&aiprop=url&format=json&origin=*';
async function animeLookup(name) {
  const key = String(name || '').replace(/[^A-Za-z0-9]/g, '');
  if (!key) return null;
  if (animeMem.has(key)) return animeMem.get(key);
  try {
    const j = await (await fetch(`${YPI}&ailimit=100&aiprefix=${encodeURIComponent(key + '-')}`)).json();
    const re = new RegExp('^' + key + '-(JP|AE|EN)-Anime-([A-Za-z0-9]+)\\.(png|jpe?g)$', 'i');
    const by = {};
    for (const im of j.query?.allimages || []) {
      const m = String(im.name).replace(/_/g, ' ').replace(/ /g, '').match(re);
      if (!m) continue;
      const ser = m[2].toUpperCase(), rank = { EN: 0, AE: 1, JP: 2 }[m[1].toUpperCase()];
      if (!by[ser] || rank < by[ser].rank) by[ser] = { rank, url: im.url };
    }
    const res = Object.keys(by).length ? by : null;
    animeMem.set(key, res);
    return res;
  } catch { return null; }
}
async function animeBacks() {
  if (animeBackMem) return animeBackMem;
  try {
    const j = await (await fetch(`${YPI}&ailimit=100&aiprefix=Back-Anime`)).json();
    animeBackMem = (j.query?.allimages || []).map((im) => ({ n: String(im.name).toLowerCase(), url: im.url }));
  } catch { return []; }
  return animeBackMem;
}
function animeBackFor(backs, ser) {
  const s = String(ser).toLowerCase();
  return (backs.find((b) => b.n.includes('-' + s) || b.n.includes('_' + s)) || backs[0] || {}).url || null;
}

function openSheet(card, p, qty, favKey) {
  const ov = $('#overlay');
  const isFav = () => S.fav.some((f) => f.k === favKey);
  const meta = rarityInfo(p.r);
  ov.hidden = false;
  const front = qty ? cardHtml(card, p.r, { big: true, fx: true, code: p.c }) : cardHtml(card, p.r, { big: true, code: p.c }).replace('class="card', 'style="filter:grayscale(1) brightness(.4)" class="card');
  ov.innerHTML = `<div class="sheet" id="sh">
    <div class="spinbox" id="sbox"><div class="body3d" id="b3d">
      <div class="face front">${front}</div>
      <div class="face back">${backHtml()}</div>${EDGES}
    </div></div>
    <div class="spinfloor" id="sfloor"></div>
    <p class="spinhint">Fais glisser pour faire tourner la carte. Double tape pour la retourner.</p>
    <div id="anime"></div>
    <div class="panel info"><h3>${esc(card.n)}</h3>
      <div class="kv"><span class="r">${esc(meta.label)}</span><span>${esc(p.c)}</span><span>${qty ? 'x' + qty : 'Non possédée'}</span>${card.k !== null ? `<span>ATK ${card.k}</span>` : ''}${card.d !== null ? `<span>DEF ${card.d}</span>` : ''}</div>
    </div>
    ${qty && favKey ? '<button class="btn ghost sm favbtn" id="sfav"></button>' : ''}
    <div class="row"><button class="btn ghost sm" id="sreset">Recentrer</button><button class="btn sm" id="shx">Fermer</button></div></div>`;
  const favBtn = $('#sfav');
  const paintFav = () => { if (favBtn) { favBtn.textContent = isFav() ? '★ Retirer de la vitrine' : '☆ Ajouter à la vitrine'; favBtn.classList.toggle('on', isFav()); } };
  paintFav();
  if (favBtn) favBtn.onclick = () => {
    if (isFav()) S.fav = S.fav.filter((f) => f.k !== favKey);
    else if (S.fav.length >= 9) { toast('Ta vitrine est pleine (9 cartes). Retire-en une d’abord.'); return; }
    else S.fav = [...S.fav, { k: favKey, a: card.a, n: card.n, r: p.r, c: p.c, atk: card.k, def: card.d }];
    saveState(S); paintFav(); toast(isFav() ? 'Ajoutée à ta vitrine' : 'Retirée de ta vitrine');
  };
  const spin = bindSpin($('#sbox'), $('#b3d'), $('.card', ov), null);
  const frontEl = $('#b3d .face.front'), backEl = $('#b3d .face.back');
  const frontHtml = frontEl.innerHTML, backHtmlOrig = backEl.innerHTML;
  animeLookup(card.n).then(async (by) => {
    if (!by || !$('#anime')) return;
    const backs = await animeBacks();
    const sers = Object.keys(by);
    let mode = 'tcg', ser = sers[0];
    const draw = () => {
      const box = $('#anime'); if (!box) return;
      box.innerHTML = `<div class="seg" id="aseg"><button data-m="tcg" class="${mode === 'tcg' ? 'on' : ''}">Carte TCG</button><button data-m="anime" class="${mode === 'anime' ? 'on' : ''}">Version anime</button></div>` +
        (mode === 'anime' && sers.length > 1 ? `<div class="chips" id="aser" style="margin:0 0 8px;padding:0">${sers.map((s) => `<button class="chip ${s === ser ? 'on' : ''}" data-s="${s}">${esc(ANIME_SERIES[s] || s)}</button>`).join('')}</div>` : '');
      $('#aseg').onclick = (e) => { const m = e.target.dataset.m; if (m) { mode = m; apply(); } };
      const as = $('#aser'); if (as) as.onclick = (e) => { const s = e.target.dataset.s; if (s) { ser = s; apply(); } };
    };
    const apply = () => {
      if (!$('#b3d')) return;
      if (mode === 'tcg') { frontEl.innerHTML = frontHtml; backEl.innerHTML = backHtmlOrig; }
      else {
        frontEl.innerHTML = `<div class="card lg"><img src="${esc(by[ser].url)}" alt="${esc(card.n)} (anime)"></div>`;
        const bu = animeBackFor(backs, ser);
        backEl.innerHTML = `<div class="cback"><div class="cb-art"></div>${bu ? `<img class="cb-img" src="${esc(bu)}" alt="" onerror="this.remove()">` : ''}</div>`;
      }
      spin.setCard($('.card', frontEl));
      draw();
    };
    draw();
  });
  const closeIt = () => { spin.stop(); ov.hidden = true; ov.innerHTML = ''; if (tab === 'home') renderHome(); };
  $('#shx').onclick = closeIt;
  $('#sreset').onclick = () => spin.reset();
  $('#sh').addEventListener('click', (e) => { if (e.target.id === 'sh') closeIt(); });
}

// ---------- Galerie des raretés : une carte exemple par rareté ----------
function renderRarities() {
  const sample = { a: ICONIC.blueEyes, n: 'Blue-Eyes White Dragon', k: 3000, d: 2500 };
  const list = Object.entries(RARITY_META).sort((x, y) => x[1].tier - y[1].tier);
  view.innerHTML = `
    ${banner([ICONIC.blueEyes, ICONIC.redEyes], 'Raretés', 'Une carte exemple par rareté. Touche pour l’incliner, ouvre-la pour la faire tourner.')}
    <button class="btn ghost sm" id="rback" style="margin-bottom:14px">← Profil</button>
    <div class="rargrid">${list.map(([key, m], i) => `<div class="rar" data-i="${i}">
      <div class="rarcard">${cardHtml(sample, key, { showName: false, fx: true })}</div>
      <div class="rarname">${esc(m.label)}</div><div class="rarsub">Palier ${m.tier}</div></div>`).join('')}</div>`;
  startHero();
  $('#rback').onclick = () => go('profile');
  document.querySelectorAll('.rar').forEach((el) => {
    const [key] = list[+el.dataset.i];
    bindTilt($('.rarcard', el), 14);
    $('.rarcard', el).onclick = () => openSheet(sample, { r: key, c: 'LOB-EN001' }, 1, null);
  });
}

// ---------- Profil ----------
function renderProfile() {
  const owned = Object.keys(S.col);
  const total = Object.values(S.col).reduce((a, b) => a + b, 0);
  const rare = owned.filter((k) => rarityInfo(k.split('||')[2]).tier >= 4).length;
  view.innerHTML = `
    ${banner([ICONIC.redEyes, ICONIC.ra], 'Profil', 'Tout est enregistré sur cet appareil.')}
    <div class="stats">
      <div class="panel stat"><b>${S.opened}</b><span>Boosters ouverts</span></div>
      <div class="panel stat"><b>${total}</b><span>Cartes obtenues</span></div>
      <div class="panel stat"><b>${owned.length}</b><span>Cartes uniques</span></div>
      <div class="panel stat"><b>${rare}</b><span>Ultimate et au-dessus</span></div>
    </div>
    <h2>Galerie</h2>
    <button class="btn ghost" id="gal">Voir les effets de chaque rareté</button>
    <h2>Sauvegarde</h2>
    <p class="sub">Exporte ta collection pour la garder ou la transférer sur un autre appareil.</p>
    <div class="row wrap">
      <button class="btn ghost sm" id="exp">Exporter</button>
      <label class="btn ghost sm" style="cursor:pointer">Importer<input type="file" id="imp" accept=".json,application/json" hidden></label>
      <button class="btn ghost sm" id="rst" style="color:var(--danger)">Réinitialiser</button>
    </div><div id="rstbox"></div>`;
  startHero();
  $('#gal').onclick = () => go('rarities');
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
    $('#rstbox').innerHTML = `<div class="err" style="margin-top:12px">Tout effacer ? Cette action est définitive.<div class="row" style="margin-top:10px"><button class="btn sm" id="yes" style="background:var(--danger);color:#2b0a12">Oui, effacer</button><button class="btn ghost sm" id="no">Annuler</button></div></div>`;
    $('#no').onclick = () => ($('#rstbox').innerHTML = '');
    $('#yes').onclick = () => { try { localStorage.removeItem('duelpacks.save.v2'); } catch {} S = loadState(); setsCache = null; go('home'); toast('Collection réinitialisée'); };
  };
}

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'home') renderHome(); });
go('home');

// bouton son (visible pendant une ouverture)
(() => {
  const b = document.createElement('button');
  b.id = 'sndbtn'; b.type = 'button';
  const paint = () => { b.textContent = SND.isMuted() ? '🔇' : '🔊'; b.setAttribute('aria-label', SND.isMuted() ? 'Activer le son' : 'Couper le son'); };
  paint();
  b.onclick = () => { SND.setMuted(!SND.isMuted()); SND.unlock(); paint(); };
  document.body.appendChild(b);
})();
