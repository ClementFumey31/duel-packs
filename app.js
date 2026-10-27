import { computeBoosters, consumeBooster, MAX_BOOSTERS, REFILL_MS, openPack, packConfigFor, packSizeFor, rarityInfo } from './engine.js';
import { loadState, saveState, parseSave } from './state.js';
import { getSets, getSetData, artUrl, cropUrl, boosterUrl, ICONIC } from './data.js';

let S = loadState();
let tab = 'home';
let setFilter = { q: '', sort: 'new' };
let colSet = null;
let colFilter = { own: 'all', rarity: 'all' };
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
function cardHtml(card, rarity, { big = false, showName = true, badge = false, gem = false } = {}) {
  const r = rarityInfo(rarity);
  return `<div class="card ${big ? 'lg' : ''} t${r.tier}" data-fx="${r.fx}">
    <img src="${artUrl(card.a)}" alt="${esc(card.n)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('noimg')">
    <div class="fx"></div><div class="fxn"></div><div class="spk"></div><div class="glare"></div>
    ${gem && r.tier > 0 ? `<span class="gem t${Math.min(7, r.tier)}" title="${esc(r.label)}"></span>` : ''}
    ${badge && r.tier > 0 ? `<span class="gem t${Math.min(7, r.tier)}"></span>` : ''}
    ${showName ? `<div class="cname">${esc(card.n)}</div>` : '<div class="cname"></div>'}
  </div>`;
}
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
function banner(ids, title, sub) {
  const imgs = ids.map((id, i) => `<img src="${cropUrl(id)}" alt="" class="${i === 0 ? 'on' : ''}" onerror="this.remove()">`).join('');
  return `<header class="hero"><div class="hero-art">${imgs}</div><div class="hero-fade"></div>
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
function setBg(t) {
  const imgs = document.querySelectorAll('#bgmon img');
  const nx = imgs[bgI ^= 1], old = imgs[bgI ^ 1];
  nx.onload = () => { nx.classList.add('on'); old.classList.remove('on'); };
  nx.src = cropUrl(ICONIC[BG[t]]);
}
function go(t) {
  tab = t;
  setBg(t);
  document.querySelectorAll('#dock button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  clearInterval(timerId);
  clearInterval(heroTimer);
  view.scrollTop = 0;
  view.style.setProperty('--sy', '0px');
  ({ home: renderHome, sets: renderSets, collection: renderCollection, profile: renderProfile })[t]();
}

// ---------- Accueil ----------
function renderHome() {
  const lastCards = S.hist.slice(0, 14);
  view.innerHTML = `
    ${banner([ICONIC.blueEyes, ICONIC.darkMagician, ICONIC.redEyes, ICONIC.exodia, ICONIC.slifer, ICONIC.obelisk, ICONIC.ra], 'Duel Packs', 'Ouvre des boosters et complète tes extensions.')}
    <section class="panel vault">
      <div class="ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a94"/><stop offset="1" stop-color="#ff2a3d"/></linearGradient></defs>
          <circle class="track" cx="60" cy="60" r="52"/>
          <circle class="prog" id="prog" cx="60" cy="60" r="52" stroke-dashoffset="326.7"/>
        </svg>
        <div class="ringtxt"><b id="n">0</b><span>sur ${MAX_BOOSTERS} boosters</span></div>
      </div>
      <p class="timer" id="timer"></p>
      <div class="slots" id="pips" aria-hidden="true"></div>
      <button class="btn" id="go">Ouvrir un booster</button>
    </section>
    <h2>Légendes</h2>
    <div class="legends">${['blueEyes', 'darkMagician', 'redEyes', 'exodia', 'slifer', 'obelisk', 'ra', 'summonedSkull', 'magicianGirl'].map((k) => `<div class="legend"><img src="${artUrl(ICONIC[k])}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>`).join('')}</div>
    <h2>Dernières cartes</h2>
    <div class="shelf" id="last">${lastCards.length ? '' : '<div class="empty" style="width:100%">Ta première carte apparaîtra ici.</div>'}</div>`;
  $('#go').onclick = () => go('sets');
  startHero();
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
    $('#prog').style.strokeDashoffset = (326.7 * (1 - p)).toFixed(1);
    $('#pips').innerHTML = Array.from({ length: MAX_BOOSTERS }, (_, i) => `<i class="${i < v.boosters ? 'full' : ''}"></i>`).join('');
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
      const pct = S.tot[s.n] ? Math.round((own / S.tot[s.n]) * 100) : null;
      return `<button class="tile" data-i="${setsCache.indexOf(s)}">
        <div class="tile-img"><span>${esc(s.c)}</span><img src="${esc(boosterUrl(s))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">${pct !== null ? `<i class="tile-pct">${pct}%</i>` : ''}</div>
        <div class="tile-name">${esc(s.n)}</div>
        <div class="tile-meta">${s.d ? esc(s.d.slice(0, 4)) + ' · ' : ''}${s.k} cartes · ${packSizeFor(s.n, s.k)}/booster</div></button>`;
    }).join('')}</div>` : '<div class="empty">Aucune extension trouvée.</div>';
    document.querySelectorAll('.tile').forEach((b) => (b.onclick = () => startOpen(setsCache[+b.dataset.i])));
  };
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
const stageBg = () => `<div class="stage-bg"><img src="${cropUrl(ICONIC.blueEyes)}" alt="" onerror="this.remove()"></div>`;

async function startOpen(set) {
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
  S.tot[set.n] = data.pool.length;

  const close = () => { fxStop(); stage.remove(); go(tab === 'sets' ? 'sets' : tab); };
  const face = `<img class="packimg" src="${esc(boosterUrl(set))}" alt="" onerror="this.remove()"><span class="packlabel">${esc(set.n)}</span>`;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span id="stinfo"></span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
    <div class="packstage" id="pstage"><div class="pack3d" id="p3d">
      <button class="pack" id="pack" aria-label="Ouvrir le booster"><span class="pk bot">${face}</span><span class="pk topc">${face}</span><i class="burst"></i></button>
      <div class="pglare"></div></div></div>
    <div class="pfloor"></div>
    <div class="hint" id="hint"><b>Touche le booster</b>pour l’ouvrir</div>`;
  $('#cl', stage).onclick = close;
  const info = () => ($('#stinfo', stage).textContent = `${tick().boosters} / ${MAX_BOOSTERS} boosters`);
  info();

  // inclinaison 3D du booster
  const p3d = $('#p3d', stage), pst = $('#pstage', stage);
  let opening = false;
  const tiltPack = (e) => {
    if (opening) return;
    const b = pst.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), py = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    p3d.style.transform = `rotateY(${(px - .5) * 34}deg) rotateX(${(.5 - py) * 24}deg)`;
    p3d.style.setProperty('--gx', px * 100 + '%'); p3d.style.setProperty('--gy', py * 100 + '%');
    $('.pglare', p3d).style.setProperty('--gx', px * 100 + '%'); $('.pglare', p3d).style.setProperty('--gy', py * 100 + '%');
  };
  stage.addEventListener('pointermove', tiltPack);
  stage.addEventListener('pointerdown', tiltPack);

  $('#pack', stage).onclick = () => {
    if (opening) return;
    const next = consumeBooster(S, Date.now());
    if (!next) { toast('Plus de booster.'); return; }
    opening = true;
    p3d.style.transform = '';
    S = { ...S, boosters: next.boosters, lastRefillAt: next.lastRefillAt, lastSeenAt: next.lastSeenAt, opened: S.opened + 1 };
    const pulled = openPack(data.pool, packConfigFor(set.n, set.d, data.pool.length));
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
    setTimeout(() => revealStep(stage, set, data, results, 0, close), 1500); // 3) les cartes sortent
  };
}

function revealStep(stage, set, data, results, i, close) {
  if (i >= results.length) return summary(stage, set, data, results, close);
  const r = results[i];
  const meta = rarityInfo(r.r);
  const tier = meta.tier;
  const gc = GLOW[tier] || GLOW[2];
  const fx = TIER_FX[Math.min(tier, 7)];
  const left = results.length - i - 1;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span>${i + 1} / ${results.length}</span><div class="row"><button class="skip" id="skip">Tout voir</button><button class="x" id="cl" aria-label="Fermer">✕</button></div></div>
    <div class="rays" id="rays" style="--gc:${gc}"></div>
    <div class="glow ${tier >= 2 ? 'on' : ''}" style="--gc:${gc}"></div>
    <div class="reveal ${tier >= 2 ? 'hot' : ''}" id="rv" style="--gc:${gc}">
      <div class="pile">${'<i></i>'.repeat(Math.min(3, left))}</div>
      <div class="tiltwrap"><div class="flipper enter" id="fl">
        <div class="face back">${backHtml()}</div>
        <div class="face front">${cardHtml(r.card, r.r, { big: true })}</div>
      </div></div>
    </div>
    <div class="hint" id="hint"><b>Touche pour retourner</b>la carte</div>
    <div class="dots">${results.map((_, k) => `<i class="${k < i ? 'd' : ''}"></i>`).join('')}</div>
    <div class="flash" id="flash"></div>`;
  const rv = $('#rv', stage), fl = $('#fl', stage), hint = $('#hint', stage);
  bindTilt(rv, 16);

  const celebrate = () => {
    hint.innerHTML = `<b>${esc(meta.label)}${r.isNew ? '<span class="new">Nouveau</span>' : ''}</b>${esc(r.c)} · glisse la carte vers le haut`;
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
  const next = () => {
    if (busy) return;
    busy = true;
    rv.classList.add('out');                            // la carte part vers le haut, comme on la retire du paquet
    setTimeout(() => revealStep(stage, set, data, results, i + 1, close), reduced() ? 10 : 460);
  };
  const flip = () => {
    flipped = true; busy = true;
    fl.classList.add('flipped');
    setTimeout(celebrate, 360);
    setTimeout(() => (busy = false), tier >= 3 ? 900 : 480);
  };
  let sy = null, swiped = false;
  stage.onpointerdown = (e) => { sy = e.clientY; swiped = false; };
  stage.onpointerup = (e) => {
    if (sy !== null && flipped && !busy && sy - e.clientY > 50) { swiped = true; next(); }
    sy = null;
  };
  stage.onclick = (e) => {
    if (e.target.closest('#cl') || e.target.closest('#skip') || busy || swiped) { swiped = false; return; }
    if (!flipped) flip(); else next();
  };
}

function summary(stage, set, data, results, close) {
  const best = results.reduce((a, b) => (rarityInfo(b.r).tier > rarityInfo(a.r).tier ? b : a));
  stage.onclick = null;
  stage.innerHTML = `${stageBg()}
    <div class="top"><span>${esc(set.n)}</span><button class="x" id="cl" aria-label="Fermer">✕</button></div>
    <div class="sumgrid"><div class="grid">${results.map((x) => `<div class="slot ${rarityInfo(x.r).tier ? 't' + Math.min(7, rarityInfo(x.r).tier) : ''}">${cardHtml(x.card, x.r, { showName: false, gem: true })}<div class="code">${x.isNew ? '<b style="color:var(--brass-hi)">Nouveau</b> · ' : ''}${esc(x.c)}</div></div>`).join('')}</div></div>
    <div class="hint" style="margin-top:18px"><b>${results.filter((x) => x.isNew).length} nouvelle(s) carte(s)</b>Meilleure : ${esc(best.card.n)} (${esc(rarityInfo(best.r).label)})</div>
    <div class="row" style="width:100%;max-width:540px;margin-top:8px">
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
  const uniq = Object.keys(S.col).length, total = Object.values(S.col).reduce((a, b) => a + b, 0);
  if (!sets.length) {
    view.innerHTML = `${banner([ICONIC.exodia, ICONIC.summonedSkull], 'Collection', 'Ta vitrine est vide pour l’instant.')}
      <div class="empty">Ouvre un premier booster depuis l’onglet Extensions.</div><button class="btn" id="g">Voir les extensions</button>`;
    $('#g').onclick = () => go('sets');
    startHero();
    return;
  }
  if (!colSet || !sets.includes(colSet)) colSet = sets[0];
  view.innerHTML = `
    ${banner([ICONIC.exodia, ICONIC.summonedSkull], 'Collection', `${uniq} cartes différentes, ${total} au total.`)}
    <div class="chips" id="setchips">${sets.map((n) => `<button class="chip ${n === colSet ? 'on' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <div class="seg" id="own"><button data-o="all" class="${colFilter.own === 'all' ? 'on' : ''}">Toutes</button><button data-o="own" class="${colFilter.own === 'own' ? 'on' : ''}">Possédées</button><button data-o="miss" class="${colFilter.own === 'miss' ? 'on' : ''}">Manquantes</button></div>
    <div id="colbody"><div class="empty"><span class="spin"></span></div></div>`;
  startHero();
  $('#setchips').onclick = (e) => { const n = e.target.dataset.n; if (n) { colSet = n; colFilter.rarity = 'all'; renderCollection(); } };
  $('#own').onclick = (e) => { const o = e.target.dataset.o; if (o) { colFilter.own = o; renderCollection(); } };
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
    <div class="compl"><b>${ownN} / ${data.pool.length}</b><span>cartes de l’extension</span></div>
    <div class="bar" style="margin-bottom:14px"><i style="width:${(ownN / data.pool.length) * 100}%"></i></div>
    <div class="chips" id="rchips"><button class="chip ${colFilter.rarity === 'all' ? 'on' : ''}" data-r="all">Toutes raretés</button>${rars.map((r) => `<button class="chip ${colFilter.rarity === r ? 'on' : ''}" data-r="${esc(r)}">${esc(rarityInfo(r).label)}</button>`).join('')}</div>
    <div class="grid" id="grid">${list.map((p, i) => {
      const q = S.col[key(p)] || 0;
      return `<button class="slot ${q ? '' : 'missing'}" data-i="${i}" aria-label="${esc(data.cards[p.i].n)}">
        ${q > 1 ? `<span class="qty">x${q}</span>` : ''}${cardHtml(data.cards[p.i], p.r, { showName: false, gem: !!q })}<div class="code">${esc(p.c)}</div></button>`;
    }).join('')}</div>${list.length ? '' : '<div class="empty">Aucune carte avec ce filtre.</div>'}`;
  $('#rchips').onclick = (e) => { const r = e.target.dataset.r; if (r) { colFilter.rarity = r; drawSetCollection(); } };
  document.querySelectorAll('#grid .slot').forEach((b) => (b.onclick = () => {
    const p = list[+b.dataset.i];
    openSheet(data.cards[p.i], p, S.col[key(p)] || 0);
  }));
}

// ---------- Fiche carte : objet 3D à faire tourner ----------
function bindSpin(box, body, card, onStop) {
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
    stop() { cancelAnimationFrame(st.raf); st.raf = 0; },
  };
}

function openSheet(card, p, qty) {
  const ov = $('#overlay');
  const meta = rarityInfo(p.r);
  ov.hidden = false;
  const front = qty ? cardHtml(card, p.r, { big: true }) : cardHtml(card, p.r, { big: true }).replace('class="card', 'style="filter:grayscale(1) brightness(.4)" class="card');
  ov.innerHTML = `<div class="sheet" id="sh">
    <div class="spinbox" id="sbox"><div class="body3d" id="b3d">
      <div class="face front">${front}</div>
      <div class="face back">${backHtml()}</div>
    </div></div>
    <div class="spinfloor" id="sfloor"></div>
    <p class="spinhint">Fais glisser pour faire tourner la carte. Double tape pour la retourner.</p>
    <div class="panel info"><h3>${esc(card.n)}</h3>
      <div class="kv"><span class="r">${esc(meta.label)}</span><span>${esc(p.c)}</span><span>${qty ? 'x' + qty : 'Non possédée'}</span>${card.k !== null ? `<span>ATK ${card.k}</span>` : ''}${card.d !== null ? `<span>DEF ${card.d}</span>` : ''}</div>
    </div>
    <div class="row"><button class="btn ghost sm" id="sreset">Recentrer</button><button class="btn sm" id="shx">Fermer</button></div></div>`;
  const spin = bindSpin($('#sbox'), $('#b3d'), $('.card', ov), null);
  const closeIt = () => { spin.stop(); ov.hidden = true; ov.innerHTML = ''; };
  $('#shx').onclick = closeIt;
  $('#sreset').onclick = () => spin.reset();
  $('#sh').addEventListener('click', (e) => { if (e.target.id === 'sh') closeIt(); });
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
    $('#rstbox').innerHTML = `<div class="err" style="margin-top:12px">Tout effacer ? Cette action est définitive.<div class="row" style="margin-top:10px"><button class="btn sm" id="yes" style="background:var(--danger);color:#2b0a12">Oui, effacer</button><button class="btn ghost sm" id="no">Annuler</button></div></div>`;
    $('#no').onclick = () => ($('#rstbox').innerHTML = '');
    $('#yes').onclick = () => { try { localStorage.removeItem('duelpacks.save.v2'); } catch {} S = loadState(); setsCache = null; go('home'); toast('Collection réinitialisée'); };
  };
}

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'home') renderHome(); });
go('home');
