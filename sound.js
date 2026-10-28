// Sons synthétisés (aucun fichier audio) : déchirure du booster et sons par rareté
let ctx = null, master = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('duelpacks.mute') === '1'; } catch (e) { /* stockage indisponible */ }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain(); master.gain.value = .7; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export const isMuted = () => muted;
export function setMuted(v) { muted = !!v; try { localStorage.setItem('duelpacks.mute', v ? '1' : '0'); } catch (e) { /* ignore */ } }
export const unlock = () => { ac(); };

function noise(t, dur, { type = 'bandpass', f0 = 2000, f1 = 2000, q = 1, gain = .3, attack = .005, curve = 1 } = {}) {
  const c = ac(); if (!c || muted) return;
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(.0008, t + dur * curve);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + .05);
}
function tone(t, freq, dur, { type = 'sine', gain = .15, attack = .004, slide = 0, det = 0 } = {}) {
  const c = ac(); if (!c || muted) return;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = det;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(.0006, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .05);
}

// déchirure : bruit de papier / film plastique qui craque, plus un claquement final
export function rip() {
  const c = ac(); if (!c || muted) return; const t = c.currentTime;
  noise(t, .5, { type: 'highpass', f0: 1800, f1: 5200, q: .7, gain: .34, attack: .01, curve: 1 });
  noise(t, .45, { type: 'bandpass', f0: 900, f1: 3400, q: 1.4, gain: .28, attack: .02 });
  for (let i = 0; i < 9; i++) noise(t + .03 + i * .045 + Math.random() * .02, .035, { type: 'bandpass', f0: 3000 + Math.random() * 3500, f1: 2000, q: 3, gain: .22 });
  tone(t + .04, 180, .16, { type: 'triangle', gain: .12, slide: .4 });
}
// l'enveloppe s'envole
export function whoosh() {
  const c = ac(); if (!c || muted) return; const t = c.currentTime;
  noise(t, .42, { type: 'bandpass', f0: 500, f1: 2800, q: .8, gain: .2, attack: .1 });
}
// friction pendant le glissement du doigt
let fr = null;
export function dragStart() {
  const c = ac(); if (!c || muted || fr) return;
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.2;
  const g = c.createGain(); g.gain.value = 0;
  s.connect(f); f.connect(g); g.connect(master); s.start();
  fr = { s, g, f };
}
export function dragSet(p) {
  if (!fr || !ctx) return;
  fr.g.gain.setTargetAtTime(Math.min(.16, p * .22), ctx.currentTime, .03);
  fr.f.frequency.setTargetAtTime(1800 + p * 2600, ctx.currentTime, .05);
}
export function dragStop() {
  if (!fr || !ctx) return;
  const x = fr; fr = null;
  x.g.gain.setTargetAtTime(0, ctx.currentTime, .04);
  setTimeout(() => { try { x.s.stop(); } catch (e) { /* ignore */ } }, 250);
}

// apparition d'une carte selon la rareté (tier 0 à 7)
export function card(tier) {
  const c = ac(); if (!c || muted) return; const t = c.currentTime;
  noise(t, .13, { type: 'bandpass', f0: 1800, f1: 900, q: .9, gain: .12, attack: .01 });          // frottement de carte
  if (tier <= 0) return;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
  const n = Math.min(tier + 1, 6);
  if (tier === 1) { tone(t + .05, 880, .35, { gain: .09, type: 'triangle' }); tone(t + .05, 1320, .3, { gain: .04 }); return; }
  for (let i = 0; i < n; i++) {                                                                       // arpège scintillant
    const f = notes[Math.min(i + (tier > 3 ? 1 : 0), 6)];
    tone(t + .05 + i * .07, f, .5 + i * .05, { gain: .08, type: 'triangle' });
    tone(t + .05 + i * .07, f * 2.01, .4, { gain: .03 });
  }
  if (tier >= 3) noise(t + .05, .7, { type: 'highpass', f0: 5000, f1: 9000, q: .5, gain: .05, attack: .2 });  // brillance
  if (tier >= 4) {
    tone(t, 98, .9, { gain: .2, type: 'sine', slide: .7 });                                          // grave profond
    noise(t, .5, { type: 'lowpass', f0: 400, f1: 80, q: 1, gain: .18, attack: .01 });
    for (let i = 0; i < 5; i++) tone(t + .4 + i * .09, 2400 + Math.random() * 2600, .25, { gain: .035 });
  }
  if (tier >= 6) {                                                                                    // accord final
    [261.63, 329.63, 392, 523.25].forEach((f, i) => tone(t + .35, f, 1.6, { gain: .09, type: 'sawtooth', det: i * 3 }));
    tone(t, 55, 1.2, { gain: .28, slide: .6 });
  }
}
