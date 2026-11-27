/*!
 * GRIT — an original desktop-companion character (compact battle-mech, neon vector).
 * Procedurally animated with Canvas 2D. No dependencies.
 *
 *   const grit = new Grit({ root: document.body });
 *   grit.say('Systems online.');
 *   grit.setState('listening');   // idle | listening | thinking | talking | alert | happy | sleep
 *   grit.act('flip');             // jump | flip | wave | dance | fly | summon | goto | sleep | wake | hide | show | draw | sheathe | fight | kata
 *   grit.setPerches([{ wid: 1, x1: 100, x2: 600, y: 300 }]);   // extra surfaces it can stand on
 */
(function (GLOBAL) {
  'use strict';

  /* ───────────────────────── math ───────────────────────── */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const smooth = (t) => t * t * (3 - 2 * t);
  const wrapPI = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x) => { const i = Math.floor(x), f = x - i; return lerp(hash(i), hash(i + 1), f * f * (3 - 2 * f)); };
  const now = () => (GLOBAL.performance ? GLOBAL.performance.now() : Date.now());
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbStr = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  function weighted(list) {
    let sum = 0; for (const [, w] of list) sum += w;
    let r = Math.random() * sum;
    for (const [v, w] of list) { if (w > 0 && (r -= w) <= 0) return v; }
    return list[0][0];
  }

  class Spring {
    constructor(value = 0, k = 300, c = 20) { this.value = value; this.vel = 0; this.target = value; this.k = k; this.c = c; }
    step(dt) { this.vel += (this.k * (this.target - this.value) - this.c * this.vel) * dt; this.value += this.vel * dt; return this.value; }
  }

  /* ───────────────────────── look ───────────────────────── */
  let PAL = {
    ink: '#0a0e15', hi: '#5c6b84', armor: '#38445c', mid: '#2b3447', lo: '#1c2230',
    deep: '#11161f', joint: '#0e1219', amber: '#ffb13b',
  };
  const STATE_COLOR = {
    idle: '#38f2ff', listening: '#46ffb2', thinking: '#b38cff', talking: '#38f2ff',
    alert: '#ffb13b', happy: '#38f2ff', sleep: '#4b7dff',
  };
  const STATES = Object.keys(STATE_COLOR);
  const CYAN = '#38f2ff';
  const BOX = 260, AX = 130, AY = 188;  // local canvas box and the feet anchor inside it
  const STAND_H = 128;                  // local units, feet → antenna tip

  const QUIPS = {
    hello: ['GRIT online.', 'Systems online. Let’s work.', 'Boots on the ground.'],
    click: ['Need something?', 'Systems green.', 'Hey — personal space.', 'Thrusters warm. Say the word.', 'On patrol.', 'Still here. Still sharp.'],
    thrown: ['Whoa—!', 'Not cool.', 'Recalibrating…', 'I meant to do that.', 'Gyros spinning…'],
    wake: ['…five more minutes.', 'I was charging!', 'Online. Mostly.'],
    back: ['Welcome back.', 'There you are.', 'Back on duty.'],
  };

  /* ───────────────────────── painter ───────────────────────── */
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); }
  function poly3(ctx, a, b, c) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); }
  function hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function torsoPath(ctx, cx, yt, yb, tw, bw) {
    ctx.beginPath();
    ctx.moveTo(cx - tw + 5, yt);
    ctx.lineTo(cx + tw - 5, yt);
    ctx.quadraticCurveTo(cx + tw, yt, cx + tw - 0.6, yt + 5);
    ctx.lineTo(cx + bw, yb - 5);
    ctx.quadraticCurveTo(cx + bw, yb, cx + bw - 5, yb);
    ctx.lineTo(cx - bw + 5, yb);
    ctx.quadraticCurveTo(cx - bw, yb, cx - bw, yb - 5);
    ctx.lineTo(cx - tw + 0.6, yt + 5);
    ctx.quadraticCurveTo(cx - tw, yt, cx - tw + 5, yt);
    ctx.closePath();
  }

  // A = animation snapshot (see Grit#_animate). Origin = feet centre, y down, drawn facing right then mirrored.
  function paint(ctx, A) {
    const u = A.u, C = (a) => rgbStr(A.col, a);
    ctx.save();
    if (A.shadow > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${0.3 * A.shadow})`;
      ctx.beginPath(); ctx.ellipse(0, 1, 23 * A.sx, 4.2, 0, 0, TAU); ctx.fill();
    }
    const spin = A.morph ? Math.cos(A.morph.spin) : 1;                 // a transformation spins him about his own axis
    ctx.scale(A.sx * (Math.abs(spin) < 0.06 ? 0.06 * (spin < 0 ? -1 : 1) : spin), A.sy);
    ctx.translate(0, -58); ctx.rotate(A.rot); ctx.translate(0, 58);
    ctx.scale(A.facing, 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const hipY = -31 + A.hipDrop + A.bob;
    const shY = hipY - 31;
    const cx = 2 * u;
    const hx = cx + 3 * u + A.headDX, hy = shY - 25 + A.headDY;
    const jx = cx - 8 - 13 * u, jTop = shY - 1, jBot = hipY - 2, nsp = 6 * (1 - 0.3 * u);

    if (A.thrust > 0.02) flames(ctx, jx, jBot + 5, nsp, A.thrust * (A.flame || 1), A.t);
    arm(ctx, A, false, cx, shY, u);
    leg(ctx, A, false, cx, hipY, u);
    jetpack(ctx, A, jx, jTop, jBot, nsp, C);
    if (A.sword < 0.5) sheathedSword(ctx, A, jx, jTop, u, C);
    leg(ctx, A, true, cx, hipY, u);
    outfitBack(ctx, A, cx, hipY, shY, u, C);
    torso(ctx, A, cx, hipY, shY, u, C);
    outfitTorso(ctx, A, cx, hipY, shY, u, C);
    let hand = null;
    if (!A.armFront) { hand = arm(ctx, A, true, cx, shY, u); outfitArm(ctx, A, hand); if (A.sword >= 0.5) heldSword(ctx, A, hand, C); }
    if (A.prop === 'mail' && hand && !A.armFront) envelope(ctx, hand.H.x, hand.H.y, C);
    head(ctx, A, hx, hy, u, C);
    if (A.armFront) { hand = arm(ctx, A, true, cx, shY, u); outfitArm(ctx, A, hand); }   // salute: hand in front of the visor
    if (A.amb && A.amb.rain && A.eyes.mode !== 'sleep') umbrella(ctx, A, hx, hy);
    ctx.restore();
    if (A.morph) {                                                      // the burst of light he changes inside
      const k = A.morph.k; ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -62, 3, 0, -62, 104);
      g.addColorStop(0, `rgba(255,255,255,${0.98 * k})`); g.addColorStop(0.42, `rgba(255,244,205,${0.62 * k})`); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.fillRect(-120, -178, 240, 200);
      if (k > 0.2) { ctx.fillStyle = `rgba(255,255,255,${0.75 * k})`; ctx.beginPath(); ctx.ellipse(0, -62, 20 * k, 66 * k, 0, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    return { hx, hy };
  }

  /* ───────────────────────── the sword ─────────────────────────
     Blade = tapered steel with a glowing energy core in the state colour; crossguard + grip + pommel.
     Sheathed: scabbard on the jetpack, hilt showing over the shoulder. Drawn: in line with the near forearm. */
  function bladePath(ctx, len, w) {
    ctx.beginPath();
    ctx.moveTo(0, -w); ctx.lineTo(len * 0.82, -w * 0.78); ctx.lineTo(len, 0); ctx.lineTo(len * 0.82, w * 0.78); ctx.lineTo(0, w);
    ctx.closePath();
  }
  function swordAt(ctx, x, y, angle, C, glow, len = 36) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    // grip (behind the hand) + pommel
    ctx.fillStyle = PAL.deep; rr(ctx, -11, -2.2, 10, 4.4, 2); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; for (let i = -9; i < -2; i += 2.5) { ctx.beginPath(); ctx.moveTo(i, -1.8); ctx.lineTo(i, 1.8); ctx.stroke(); }
    ctx.fillStyle = PAL.amber; circle(ctx, -12, 0, 2.3); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4; ctx.stroke();
    // blade
    ctx.save();
    ctx.translate(4, 0);
    const g = ctx.createLinearGradient(0, -4, 0, 4);
    g.addColorStop(0, '#d9e6f5'); g.addColorStop(0.5, '#8ea2c0'); g.addColorStop(1, '#4a5a74');
    if (glow > 0.02) { ctx.shadowColor = C(1); ctx.shadowBlur = 10 * glow; }
    bladePath(ctx, len, 3.6); ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = C(0.55 + 0.45 * glow); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(len * 0.86, 0); ctx.stroke();
    ctx.restore();
    // crossguard (over the blade base)
    ctx.fillStyle = PAL.hi; rr(ctx, 1.5, -6.5, 4.5, 13, 2); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = C(0.9); circle(ctx, 3.7, 0, 1.4); ctx.fill();
    ctx.restore();
  }
  function sheathedSword(ctx, A, jx, jTop, u, C) {
    // scabbard strapped to the pack, hilt rising behind the head; mostly hidden by the torso, which is the point
    const ang = -Math.PI / 2 - (0.55 + 0.25 * u);   // leans back over the pack so the hilt shows beside the head
    const bx = jx - 3, by = jTop + 10;
    ctx.save();
    ctx.translate(bx, by); ctx.rotate(ang);
    ctx.fillStyle = PAL.lo; rr(ctx, -4, -4.2, 34, 8.4, 3); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = PAL.mid; rr(ctx, 8, -2.6, 7, 5.2, 1.5); ctx.fill();   // strap
    ctx.fillStyle = C(0.6); rr(ctx, 24, -1, 4, 2, 1); ctx.fill();          // scabbard light
    ctx.restore();
    // the hilt pokes out of the scabbard mouth
    swordAt(ctx, bx + Math.cos(ang) * 31, by + Math.sin(ang) * 31, ang, C, 0.25 * A.glow, 3.5);
  }
  function heldSword(ctx, A, hand, C) {
    if (!hand) return;
    const ang = Math.atan2(hand.H.y - hand.E.y, hand.H.x - hand.E.x) + (A.swordTwist || 0);
    swordAt(ctx, hand.H.x, hand.H.y, ang, C, 0.6 + 0.4 * A.glow + (A.swordFlash || 0));
    A._seg = { x0: hand.H.x + Math.cos(ang) * 6, y0: hand.H.y + Math.sin(ang) * 6, x1: hand.H.x + Math.cos(ang) * 40, y1: hand.H.y + Math.sin(ang) * 40 };
  }

  function flames(ctx, jx, y0, sp, k, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) {
      const nx = jx + s * sp;
      const fl = 0.82 + 0.12 * Math.sin(t * 47 + s * 2.1) + 0.08 * Math.sin(t * 93 + s);
      const len = (12 + 34 * k) * fl, w = 3.6 + 1.6 * k;
      let g = ctx.createLinearGradient(0, y0, 0, y0 + len * 1.3);
      g.addColorStop(0, 'rgba(255,170,60,0.55)'); g.addColorStop(1, 'rgba(255,60,30,0)');
      ctx.fillStyle = g; drop(ctx, nx, y0, w * 1.9, len * 1.3); ctx.fill();
      g = ctx.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.3, 'rgba(255,214,120,0.95)');
      g.addColorStop(0.7, 'rgba(255,120,50,0.55)'); g.addColorStop(1, 'rgba(255,80,40,0)');
      ctx.fillStyle = g; drop(ctx, nx, y0, w, len); ctx.fill();
    }
    ctx.restore();
  }
  function drop(ctx, x, y, w, len) {
    ctx.beginPath(); ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w * 1.05, y + len * 0.45, x, y + len);
    ctx.quadraticCurveTo(x + w * 1.05, y + len * 0.45, x + w, y);
    ctx.closePath();
  }

  // Arms: a1 = raise angle (0 down, π up), a2 = elbow bend, sp = sideways spread (−1 inward … 1 outward).
  // The swing is projected through the body's turn so it reads in front, 3/4 and profile views.
  function arm(ctx, A, near, cx, shY, u) {
    const cz = Math.sqrt(Math.max(0, 1 - u * u));
    const side = near ? 1 : -1;
    const g = near ? A.arms.near : A.arms.far;
    const sp = clamp(g.sp || 0, -1, 1), fw = 1 - Math.abs(sp);
    const dx = (a) => side * Math.abs(Math.sin(a)) * sp * cz + Math.sin(a) * fw * u;
    const S = { x: cx + side * 21 * cz + 2 * u, y: shY + 4 };
    const E = { x: S.x + 13.5 * dx(g.a1), y: S.y + 13.5 * Math.cos(g.a1) };
    const H = { x: E.x + 12.5 * dx(g.a1 + g.a2), y: E.y + 12.5 * Math.cos(g.a1 + g.a2) };
    const fill = near ? PAL.armor : PAL.mid;
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(S.x, S.y); ctx.lineTo(E.x, E.y); ctx.stroke();
    ctx.strokeStyle = fill; ctx.lineWidth = 5.6; ctx.stroke();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 11.5; ctx.beginPath(); ctx.moveTo(E.x, E.y); ctx.lineTo(H.x, H.y); ctx.stroke();
    ctx.strokeStyle = near ? PAL.hi : PAL.armor; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(lerp(E.x, H.x, 0.35), lerp(E.y, H.y, 0.35)); ctx.lineTo(lerp(E.x, H.x, 0.62), lerp(E.y, H.y, 0.62)); ctx.stroke();
    ctx.fillStyle = PAL.joint; circle(ctx, E.x, E.y, 3.4); ctx.fill();
    ctx.fillStyle = near ? PAL.hi : PAL.armor; circle(ctx, H.x, H.y, 5.9); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.save();
    ctx.translate(S.x, S.y - 2); ctx.rotate(Math.sin(g.a1) * 0.15 * u);
    const gr = ctx.createLinearGradient(0, -7, 0, 7);
    gr.addColorStop(0, near ? PAL.hi : PAL.armor); gr.addColorStop(1, near ? PAL.armor : PAL.lo);
    roundPoly(ctx, [{ x: -11.5, y: -6.5 }, { x: 11.5, y: -6.5 }, { x: 9.5, y: 7.5 }, { x: -9.5, y: 7.5 }], 3.5);
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(ctx, -9, -5, 18, 3, 1.5); ctx.fill();
    if (near) { ctx.fillStyle = PAL.amber; rr(ctx, -7, 3.2, 14, 2.4, 1.2); ctx.fill(); }
    ctx.restore();
    return { S, E, H };
  }
  function roundPoly(ctx, pts, r) {
    const n = pts.length, a = pts[n - 1], b = pts[0];
    ctx.beginPath();
    ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; ctx.arcTo(p.x, p.y, q.x, q.y, r); }
    ctx.closePath();
  }

  function leg(ctx, A, near, cx, hipY, u) {
    const F = near ? A.feet.near : A.feet.far;
    const H = { x: near ? cx + 8 - 5 * u : cx - 8 + 6 * u, y: hipY + 1 };
    const K0 = { x: F.x, y: F.y - 6.5 };
    let dx = K0.x - H.x, dy = K0.y - H.y, d = Math.hypot(dx, dy) || 0.001;
    const L = 14.5, max = 2 * L - 0.05;
    if (d > max) { K0.x = H.x + (dx / d) * max; K0.y = H.y + (dy / d) * max; dx = K0.x - H.x; dy = K0.y - H.y; d = max; }
    const hg = Math.sqrt(Math.max(0, L * L - (d * d) / 4));
    const nx = (dy / d) * (0.3 + 0.7 * u), ny = -dx / d;
    const K = { x: H.x + dx / 2 + nx * hg, y: H.y + dy / 2 + ny * hg };
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 12; poly3(ctx, H, K, K0); ctx.stroke();
    ctx.strokeStyle = near ? PAL.armor : PAL.mid; ctx.lineWidth = 8.4; poly3(ctx, H, K, K0); ctx.stroke();
    ctx.fillStyle = near ? PAL.hi : PAL.armor; circle(ctx, K.x, K.y, 5); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.8; ctx.stroke();
    const heel = K0.x - 7.5 + 0.5 * u, toe = K0.x + 7.5 + 6 * u, top = K0.y - 3, bot = K0.y + 7;
    const bg = ctx.createLinearGradient(0, top, 0, bot);
    bg.addColorStop(0, near ? PAL.hi : PAL.armor); bg.addColorStop(1, near ? PAL.mid : PAL.lo);
    ctx.fillStyle = bg; rr(ctx, heel, top, toe - heel, bot - top, 4); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = PAL.deep; ctx.fillRect(heel + 1.5, bot - 2.6, toe - heel - 3, 1.8);
  }

  function jetpack(ctx, A, jx, top, bot, sp, C) {
    const g = ctx.createLinearGradient(jx - 11, 0, jx + 11, 0);
    g.addColorStop(0, PAL.lo); g.addColorStop(1, PAL.mid);
    ctx.fillStyle = g; rr(ctx, jx - 12.5, top, 25, bot - top, 6); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const y = top + 6 + i * 4; ctx.beginPath(); ctx.moveTo(jx - 8, y); ctx.lineTo(jx - 2, y); ctx.stroke(); }
    ctx.fillStyle = C(0.9); circle(ctx, jx - 6.5, bot - 5, 1.3); ctx.fill();
    for (const s of [-1, 1]) {
      const nx = jx + s * sp;
      ctx.beginPath(); ctx.moveTo(nx - 3, bot - 1); ctx.lineTo(nx + 3, bot - 1); ctx.lineTo(nx + 4.4, bot + 5); ctx.lineTo(nx - 4.4, bot + 5); ctx.closePath();
      ctx.fillStyle = PAL.deep; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
      if (A.thrust > 0.02) { ctx.fillStyle = `rgba(255,190,90,${0.85 * A.thrust})`; ctx.beginPath(); ctx.ellipse(nx, bot + 5, 3.4, 1.4, 0, 0, TAU); ctx.fill(); }
    }
  }

  function torso(ctx, A, cx, hipY, shY, u, C) {
    const tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yt = shY, yb = hipY + 2;
    ctx.fillStyle = PAL.joint; rr(ctx, cx - 6 + 2 * u, yt - 10, 12, 12, 3); ctx.fill();
    const g = ctx.createLinearGradient(0, yt, 0, yb);
    g.addColorStop(0, PAL.hi); g.addColorStop(0.45, PAL.armor); g.addColorStop(1, PAL.lo);
    torsoPath(ctx, cx, yt, yb, tw, bw); ctx.fillStyle = g; ctx.fill();
    ctx.save();
    torsoPath(ctx, cx, yt, yb, tw, bw); ctx.clip();
    if (u > 0.01) { ctx.fillStyle = `rgba(4,7,13,${0.32 * u})`; ctx.fillRect(cx - tw - 2, yt - 2, tw * 0.8, yb - yt + 4); }
    torsoPath(ctx, cx + 1.5 * u, yt + 3, yt + 19, tw - 4, tw - 7);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) { const y = yt + 22.5 + i * 3; ctx.beginPath(); ctx.moveTo(cx - bw + 4, y); ctx.lineTo(cx + bw - 4, y); ctx.stroke(); }
    ctx.fillStyle = PAL.deep; ctx.fillRect(cx - tw, yb - 6, tw * 2, 6);
    ctx.fillStyle = PAL.amber;
    for (const k of [-1, 1]) { circle(ctx, cx + 3 * u + k * 3.2, yb - 3, 1.05); ctx.fill(); }
    ctx.strokeStyle = C(0.35); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx + tw - 1.2, yt + 5); ctx.lineTo(cx + bw - 1, yb - 6); ctx.stroke();
    ctx.restore();
    torsoPath(ctx, cx, yt, yb, tw, bw); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.2; ctx.stroke();
    const kx = cx + 4.5 * u, ky = yt + 11.5;
    ctx.save(); ctx.shadowColor = C(1); ctx.shadowBlur = 12 * A.glow;
    ctx.fillStyle = C(0.95); hexPath(ctx, kx, ky, 5.4); ctx.fill(); ctx.restore();
    ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * A.glow})`; hexPath(ctx, kx, ky, 2.1); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; hexPath(ctx, kx, ky, 5.4); ctx.stroke();
  }

  function head(ctx, A, hx, hy, u, C) {
    ctx.save();
    ctx.translate(hx, hy); ctx.rotate(A.headTilt);
    const hw = 30 * (1 - 0.07 * u), hh = 22;
    outfitHeadBack(ctx, A, hw, hh);
    antenna(ctx, A, -9 - 6 * u, -hh + 1.5, C, A.outfit === 'spirit');
    const g = ctx.createLinearGradient(0, -hh, 0, hh);
    g.addColorStop(0, PAL.hi); g.addColorStop(0.5, PAL.armor); g.addColorStop(1, PAL.lo);
    rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.fillStyle = g; ctx.fill();
    ctx.save();
    rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(ctx, -11 - 8 * u, -hh + 2.5, 22, 6.5, 3.2); ctx.fill();
    ctx.fillStyle = 'rgba(8,11,18,0.55)'; ctx.fillRect(-hw, hh - 8, hw * 2, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = -1; i <= 1; i++) rr(ctx, 7.5 * u + i * 5 - 1.6, hh - 6.2, 3.2, 3.6, 1);
    if (u > 0.01) { ctx.fillStyle = `rgba(4,7,13,${0.3 * u})`; ctx.fillRect(-hw - 1, -hh - 1, hw * 0.75, hh * 2 + 2); }
    ctx.strokeStyle = C(0.32); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-hw * 0.2, -hh + 1.2); ctx.lineTo(hw - 12, -hh + 1.2); ctx.quadraticCurveTo(hw - 1.2, -hh + 1.2, hw - 1.2, -hh + 12); ctx.stroke();
    ctx.restore();
    if (u > 0.05) {
      ctx.globalAlpha = Math.min(1, u * 2.2);
      ctx.fillStyle = PAL.mid; rr(ctx, -hw - 2.5, -8, 8, 17, 3.5); ctx.fill();
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      for (const y of [-3, 1, 5]) { ctx.beginPath(); ctx.moveTo(-hw, y); ctx.lineTo(-hw + 3, y); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.4; ctx.stroke();
    // visor
    const vw = 22 - 3.5 * u, vh = 10.5, vx = 7.5 * u, vy = 2.5;
    rr(ctx, vx - vw, vy - vh, vw * 2, vh * 2, 8.5);
    const vg = ctx.createLinearGradient(0, vy - vh, 0, vy + vh);
    vg.addColorStop(0, '#0a1019'); vg.addColorStop(1, '#020409');
    ctx.fillStyle = vg; ctx.fill();
    ctx.save(); ctx.clip();
    const rg = ctx.createRadialGradient(vx, vy, 1, vx, vy, vw * 1.15);
    rg.addColorStop(0, C(0.05 + 0.2 * A.glow)); rg.addColorStop(1, C(0));
    ctx.fillStyle = rg; ctx.fillRect(vx - vw, vy - vh, vw * 2, vh * 2);
    eyes(ctx, A, vx + 1.5 * u, vy - 0.3, u, C);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(vx - vw + 3, vy - vh); ctx.lineTo(vx - vw + 13, vy - vh); ctx.lineTo(vx - vw + 5, vy + vh); ctx.lineTo(vx - vw - 5, vy + vh); ctx.closePath(); ctx.fill();
    ctx.restore();
    rr(ctx, vx - vw, vy - vh, vw * 2, vh * 2, 8.5); ctx.strokeStyle = C(0.55); ctx.lineWidth = 1.3; ctx.stroke();
    outfitHead(ctx, A, hw, hh, vx, vy, vw, vh, u, C);
    if (A.outfit === 'spirit') wisp(ctx, A, -9 - 6 * u, -hh + 1.5, C);
    ctx.restore();
  }

  function antenna(ctx, A, bx, by, C, stub) {
    const a = A.antenna, L = stub ? 6 : 15;
    const tx = bx + Math.sin(a) * L, ty = by - Math.cos(a) * L;
    const mx = bx + Math.sin(a * 0.4) * L * 0.5, my = by - Math.cos(a * 0.4) * L * 0.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 3.6; ctx.stroke();
    ctx.strokeStyle = PAL.hi; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = PAL.mid; rr(ctx, bx - 4.5, by - 2.5, 9, 4.5, 2); ctx.fill();
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4; ctx.stroke();
    if (stub) return;
    ctx.save(); ctx.shadowColor = C(1); ctx.shadowBlur = 4 + 10 * A.glow;
    ctx.fillStyle = C(1); circle(ctx, tx, ty, 3.5); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; circle(ctx, tx - 1, ty - 1, 1.2); ctx.fill();
  }

  function eyes(ctx, A, x, y, u, C) {
    const E = A.eyes, t = A.t;
    const sp = 10 * (1 - 0.22 * u), lx = E.lx * 3.4, ly = E.ly * 2.4;
    const ty = E.talk > 0.01 ? -2.2 : 0;
    const L = { x: x - sp + lx, y: y + ly + ty, w: 1 - 0.28 * u }, R = { x: x + sp + lx, y: y + ly + ty, w: 1 };
    ctx.save();
    ctx.shadowColor = C(1); ctx.shadowBlur = 8;
    ctx.fillStyle = C(1); ctx.strokeStyle = C(1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    switch (E.mode) {
      case 'listen':
        for (let i = 0; i < 5; i++) { const h = 2.6 + 13 * clamp(E.level[i], 0, 1); rr(ctx, x + (i - 2) * 5.6 + lx * 0.4 - 1.5, y - h / 2, 3, h, 1.5); ctx.fill(); }
        break;
      case 'think':
        for (let i = 0; i < 3; i++) {
          let ph = (t * 1.6 - i * 0.22) % 1; if (ph < 0) ph += 1;
          const b = Math.max(0, Math.sin(ph * Math.PI));
          ctx.globalAlpha = 0.35 + 0.65 * b;
          circle(ctx, x + (i - 1) * 7.5, y - 1.5 * b, 2.1 + 1.1 * b); ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case 'happy':
        ctx.lineWidth = 3;
        for (const e of [L, R]) { ctx.beginPath(); ctx.moveTo(e.x - 4.2 * e.w, e.y + 2); ctx.quadraticCurveTo(e.x, e.y - 5.5, e.x + 4.2 * e.w, e.y + 2); ctx.stroke(); }
        break;
      case 'sleep':
        ctx.lineWidth = 2.2; ctx.globalAlpha = 0.75;
        for (const e of [L, R]) { ctx.beginPath(); ctx.moveTo(e.x - 4 * e.w, e.y + 0.5); ctx.quadraticCurveTo(e.x, e.y + 3.2, e.x + 4 * e.w, e.y + 0.5); ctx.stroke(); }
        ctx.globalAlpha = 1;
        break;
      case 'dizzy':
        ctx.lineWidth = 2.3;
        for (const e of [L, R]) {
          ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(t * 6);
          ctx.beginPath(); ctx.moveTo(-3.5, -3.5); ctx.lineTo(3.5, 3.5); ctx.moveTo(3.5, -3.5); ctx.lineTo(-3.5, 3.5); ctx.stroke();
          ctx.restore();
        }
        break;
      case 'surprised':
        ctx.lineWidth = 2.1;
        for (const e of [L, R]) { ctx.beginPath(); ctx.ellipse(e.x, e.y, 4.8 * e.w, 5.4, 0, 0, TAU); ctx.stroke(); circle(ctx, e.x, e.y, 1.7); ctx.fill(); }
        break;
      case 'alert':
        for (const [e, s] of [[L, -1], [R, 1]]) {
          const w = 4.2 * e.w, top = e.y - 5, bot = e.y + 4.5;
          ctx.beginPath();
          ctx.moveTo(e.x - w, s < 0 ? top : top + 3.6);
          ctx.lineTo(e.x + w, s < 0 ? top + 3.6 : top);
          ctx.lineTo(e.x + w, bot); ctx.lineTo(e.x - w, bot); ctx.closePath(); ctx.fill();
        }
        break;
      default: {
        // pills with the inner top corner cut lower: a calm, focused look
        const open = clamp(E.open, 0.1, 1);
        for (const [e, inner] of [[L, 1], [R, -1]]) {
          const w = 8 * e.w, h = 12 * open, sl = 3.4 * open, x0 = e.x - w / 2, x1 = e.x + w / 2, y0 = e.y - h / 2, y1 = e.y + h / 2;
          roundPoly(ctx, [{ x: x0, y: y0 + (inner < 0 ? sl : 0) }, { x: x1, y: y0 + (inner > 0 ? sl : 0) }, { x: x1, y: y1 }, { x: x0, y: y1 }], Math.min(2.6, h / 2 - 0.2));
          ctx.fill();
        }
      }
    }
    if (E.talk > 0.01 && E.mode !== 'listen' && E.mode !== 'think') {
      ctx.lineWidth = 1.6; ctx.shadowBlur = 6;
      ctx.beginPath();
      const n = 10, w = 16, my = y + 6.4;
      for (let i = 0; i <= n; i++) {
        const k = i / n, px = x + lx * 0.5 - w / 2 + k * w;
        const py = my + Math.sin(k * 9 + t * 22) * E.talk * 2.6 * Math.sin(k * Math.PI);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ───────────────────────── outfits ─────────────────────────
     Five original looks, each a palette + a few extra layers painted around the body + small behaviour
     changes. They are genre moods (ronin, shinobi, mecha pilot, neon street, spirit guardian), not copies
     of anyone's character. Layers are painted at fixed hooks inside paint()/head() so they move with him. */
  const BASE_PAL = Object.assign({}, PAL);
  const OUTFITS = {
    none:    { label: 'Factory', pal: {}, greet: 'wave', hopFx: 'dust', flame: 1, note: 1, quips: {} },
    ronin:   { label: 'Ronin', pal: { hi: '#5e6280', armor: '#393d55', mid: '#2a2d40', lo: '#1b1d2a', amber: '#e0533f' }, greet: 'bow', hopFx: 'dust', flame: 1, note: 1,
               quips: { hello: ['The road is long. Speak.', 'A blade and a purpose. Online.'], click: ['Patience.', 'The wind says nothing today.', 'Speak plainly.'], wake: ['…the dream was a quiet lake.', 'A warrior rests lightly.'], back: ['You return. Good.'], thrown: ['Undignified.', 'Hmph.'] } },
    shinobi: { label: 'Shinobi', pal: { hi: '#3f4654', armor: '#272c37', mid: '#1b1f28', lo: '#12151c', amber: '#ff5a3c' }, greet: 'vanish', hopFx: 'smoke', flame: 0.8, note: 1,
               quips: { hello: ['…here.', 'In the shadows. Listening.'], click: ['You found me.', 'Quiet.', 'Eyes open.'], wake: ['Never asleep.', '…I was watching.'], back: ['I saw you leave.'], thrown: ['Noted.'] } },
    pilot:   { label: 'Mecha pilot', pal: { hi: '#eef1f5', armor: '#cdd4dd', mid: '#a9b2be', lo: '#7b8592', deep: '#56606c', joint: '#3f4852', amber: '#ff7a1a' }, greet: 'salute', hopFx: 'spark', flame: 1.7, note: 1,
               quips: { hello: ['Systems nominal. Pilot ready.', 'All green across the board.'], click: ['Copy that.', 'Standing by on channel two.', 'Thrusters warm.'], wake: ['Reactor spinning up.', 'Back in the cockpit.'], back: ['Welcome back, commander.'], thrown: ['Mayday— kidding.', 'G-force!'] } },
    street:  { label: 'Neon street', pal: { hi: '#4d4273', armor: '#332b4f', mid: '#241e3a', lo: '#171229', amber: '#ff3fa4' }, greet: 'fist', hopFx: 'dust', flame: 1, note: 1.7,
               quips: { hello: ['Yo. Online.', 'Sup. What are we doing today?'], click: ['Easy.', 'Say less.', 'Vibes are good.'], wake: ['Five more minutes, for real.', 'Yo… I was napping.'], back: ['Welcome back, fam.'], thrown: ['Bro.', 'Not chill.'] } },
    spirit:  { label: 'Spirit guardian', pal: { hi: '#f4f0e7', armor: '#d9d2c3', mid: '#b7afa0', lo: '#8e877a', deep: '#6a6358', joint: '#4e4842', amber: '#d9a441' }, greet: 'bow', hopFx: 'sparkle', flame: 1, note: 1,
               quips: { hello: ['The lantern is lit.', 'I am here, as before.'], click: ['Be still.', 'All things pass.', 'Ask, and I will listen.'], wake: ['…the river was warm.', 'I drifted. I return.'], back: ['Welcome home.'], thrown: ['The wind carries me.'] } },
    kaiju:   { label: 'Kaiju', pal: { hi: '#8fe08a', armor: '#58b85d', mid: '#3f9449', lo: '#2c7037', deep: '#1f4f27', joint: '#234a2a', amber: '#ffd84a' }, greet: 'wave', hopFx: 'dust', flame: 1, note: 1.4,
               quips: { hello: ['Rawr! I mean, hi.', 'Tiny monster, reporting in.'], click: ['Rawr.', 'I am very scary.', 'Boop me again, I dare you.'], wake: ['Five more minutes… rawr.', 'I was hibernating.'], back: ['You came back! Rawr!'], thrown: ['Wheee!', 'Kaiju can fly!'] } },
    oni:     { label: 'Oni', pal: { hi: '#c2534a', armor: '#96342e', mid: '#6d2320', lo: '#481614', deep: '#2e0e0d', joint: '#2a1a1a', amber: '#f2c14e' }, greet: 'fist', hopFx: 'spark', flame: 1.4, note: 1,
               quips: { hello: ['The mountain shakes. I am awake.', 'Speak, small one.'], click: ['Hah!', 'You dare?', 'Stronger. Poke harder.'], wake: ['Who wakes the oni?', 'I dreamt of thunder.'], back: ['You return. Bring snacks next time.'], thrown: ['HAH! Again!', 'The oni fears nothing.'] } },
    drifter: { label: 'Star drifter', pal: { hi: '#9a9ca3', armor: '#74777f', mid: '#54575e', lo: '#3a3c42', amber: '#e8a13a' }, greet: 'salute', hopFx: 'dust', flame: 1, note: 1,
               quips: { hello: ['Howdy, partner.', 'Long road. Good to see a friendly face.'], click: ['Easy there.', 'Reckon so.', 'Much obliged.'], wake: ['Just resting my eyes.', 'Sun up already?'], back: ['Well, look who rode back in.'], thrown: ['Whoa, nelly!', 'Rough landing, partner.'] } },
    pirate:  { label: 'Pirate captain', pal: { hi: '#52648a', armor: '#35435f', mid: '#252f46', lo: '#171e30', amber: '#f2c14e' }, greet: 'salute', hopFx: 'dust', flame: 1, note: 1.3,
               quips: { hello: ['Ahoy, captain on deck!', 'Anchors up. Where to?'], click: ['Arr.', 'Mind the parrot.', 'Aye?'], wake: ['Who rang the bell?', 'I was dreaming of treasure.'], back: ['Ahoy again!'], thrown: ['Man overboard!', 'Batten down the hatches!'] } },
    vampire: { label: 'Vampire', pal: { hi: '#6a6782', armor: '#45435c', mid: '#302e43', lo: '#1d1c2b', amber: '#e0334f' }, greet: 'bow', hopFx: 'smoke', flame: 0.8, note: 1,
               quips: { hello: ['Good evening.', 'The night is young. So am I, roughly.'], click: ['Charmed.', 'Mind the cape.', 'How delightfully forward.'], wake: ['Is it dusk already?', 'I never sleep. I rest dramatically.'], back: ['Ah. You have returned.'], thrown: ['I meant to do that.', 'Undignified.'] } },
    reaper:  { label: 'Reaper', pal: { hi: '#f1eee4', armor: '#d6d1c2', mid: '#b0ab9c', lo: '#858173', deep: '#5b584f', joint: '#403e38', amber: '#7df9c9' }, greet: 'vanish', hopFx: 'smoke', flame: 0.8, note: 1,
               quips: { hello: ['Relax. I am only here for your deadlines.', 'I have arrived. Early, for once.'], click: ['Not your time yet.', 'Yes?', 'I am off the clock.'], wake: ['Even I need rest.', 'Dead tired.'], back: ['You again. Good.'], thrown: ['I have survived worse.', 'Rude.'] } },
    shark:   { label: 'Shark', pal: { hi: '#9cc4e2', armor: '#6a9bc2', mid: '#4e7da3', lo: '#386384', deep: '#264a66', joint: '#2a4c66', amber: '#ffd84a' }, greet: 'wave', hopFx: 'sparkle', flame: 1, note: 1.4,
               quips: { hello: ['Chomp chomp. Hello!', 'Fin-tastic to see you.'], click: ['Chomp.', 'Just keep swimming.', 'That tickles my gills.'], wake: ['Sharks never stop moving. I did. Oops.', 'Blub.'], back: ['You swam back!'], thrown: ['Flying fish!', 'Splash!'] } },
    pharaoh: { label: 'Pharaoh', pal: { hi: '#f6da8a', armor: '#dfb54c', mid: '#b98f32', lo: '#8f6c22', deep: '#624a17', joint: '#4b3a1a', amber: '#33c6d9' }, greet: 'bow', hopFx: 'sparkle', flame: 1, note: 1,
               quips: { hello: ['The pharaoh grants you an audience.', 'So it is written. I am online.'], click: ['You may approach.', 'It shall be done.', 'Careful. Cursed, possibly.'], wake: ['Three thousand years, and still tired.', 'Who opened the tomb?'], back: ['The kingdom welcomes you back.'], thrown: ['Unhand your king!', 'This was not in the prophecy.'] } },
    knight:  { label: 'Knight', pal: { hi: '#e6ebf2', armor: '#bfc8d4', mid: '#98a2b0', lo: '#727c8a', deep: '#4e5661', joint: '#3c424b', amber: '#e0334f' }, greet: 'salute', hopFx: 'spark', flame: 1.2, note: 1,
               quips: { hello: ['At your service.', 'My shield is yours.'], click: ['Yes, my liege?', 'On my honour.', 'Stand fast.'], wake: ['I was keeping watch. With my eyes shut.', 'The watch resumes.'], back: ['Welcome back, my liege.'], thrown: ['For honour!', 'A tactical retreat!'] } },
  };
  const OUTFIT_NAMES = Object.keys(OUTFITS);
  function usePalette(name) { PAL = Object.assign({}, BASE_PAL, (OUTFITS[name] || OUTFITS.none).pal); }
  const NEON = '#ff3fa4', GOLD = '#d9a441', RED = '#c8402f', STRAW = '#cfae6c', STRAW_D = '#8f6f3e';

  /* ───────── nine more outfits ─────────
     Kaiju, Oni, Star drifter, Pirate captain, Vampire, Reaper, Shark, Pharaoh, Knight. Same idea as the first
     five — genre archetypes, not anyone's character — but each one's layers live together in XO below
     (back / torso / arm / headBack / head), called from the same hooks. */
  const IVORY = '#f3ead2', CRIM = '#c8243f', TEAL = '#7df9c9', LAPIS = '#2456a6', GLD = '#e8c15c';
  function poly(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
  function inked(ctx, fill, lw) { ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = lw || 2; ctx.stroke(); }
  function cloak(ctx, A, cx, top, bot, wTop, wBot, fill, n, d) {
    const sway = Math.sin(A.t * 2.1) * 2.2 + A.sway;
    ctx.beginPath(); ctx.moveTo(cx - wTop, top); ctx.lineTo(cx - wBot + sway, bot); hem(ctx, cx - wBot + sway, cx + wBot + sway, bot, n, d, A.t * 2.6); ctx.lineTo(cx + wTop, top); ctx.closePath();
    inked(ctx, fill, 2); return sway;
  }
  const XO = {
    /* ── Kaiju: dino onesie — toothy hood with eyes, belly patch, tail ── */
    kaiju: {
      back(ctx, A, cx, hipY, shY, u) {
        const t = A.t, wag = clamp(A.eyes.talk * 3, 0, 1), s = Math.sin(t * (2.6 + 7 * wag)) * (3 + 3 * wag) + A.sway * 1.5;
        ctx.beginPath(); ctx.moveTo(cx - 8, hipY - 9); ctx.quadraticCurveTo(cx - 38, hipY - 6 + s * 0.4, cx - 56, hipY + 12 + s); ctx.quadraticCurveTo(cx - 34, hipY + 13 + s * 0.4, cx - 6, hipY + 6); ctx.closePath();
        inked(ctx, '#58b85d', 2.2);
        for (const [k, r] of [[0.3, 5], [0.5, 4.4], [0.7, 3.6]]) { const x = lerp(cx - 10, cx - 54, k), y = hipY - 8 + k * k * 20 + s * k; poly(ctx, [[x - r, y + 1], [x - 1, y - r - 2.5], [x + r, y + 1.5]]); inked(ctx, '#ffd84a', 1.5); }
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2;
        ctx.save(); torsoPath(ctx, cx, shY, yb, tw, bw); ctx.clip();
        ctx.fillStyle = '#eaf7c8'; ctx.beginPath(); ctx.ellipse(cx + 4 * u, shY + 20, 11.5, 17, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.strokeStyle = 'rgba(88,140,70,0.6)'; ctx.lineWidth = 1.2; for (const y of [10, 16, 22, 28]) { ctx.beginPath(); ctx.moveTo(cx + 4 * u - 8, shY + y); ctx.quadraticCurveTo(cx + 4 * u, shY + y + 2.4, cx + 4 * u + 8, shY + y); ctx.stroke(); }
        ctx.restore();
      },
      headBack(ctx, A, hw, hh) {
        for (const [x, r] of [[-22, 6], [-9, 7.5], [5, 6.5]]) { poly(ctx, [[x - r, -hh - 7], [x - 2, -hh - 9 - r * 1.9], [x + r, -hh - 7]]); inked(ctx, '#ffd84a', 1.8); }
        rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 17, 21); inked(ctx, '#58b85d', 2.2);
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        ctx.save(); rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 17, 21); ctx.clip();
        ctx.beginPath(); ctx.moveTo(-hw - 8, 5); ctx.lineTo(-hw - 8, -hh - 10); ctx.lineTo(hw + 8, -hh - 10); ctx.lineTo(hw + 8, 5);
        ctx.lineTo(hw - 2, 5); ctx.quadraticCurveTo(hw - 2, -hh + 5, 0, -hh + 5); ctx.quadraticCurveTo(-hw + 2, -hh + 5, -hw + 2, 5); ctx.closePath();
        inked(ctx, '#6cc96f', 2); ctx.restore();
        for (const x of [-19, -9.5, 0, 9.5, 19]) { const yy = -hh + 5 + (Math.abs(x) > 15 ? 2.6 : Math.abs(x) > 5 ? 0.6 : 0); poly(ctx, [[x - 4.2, yy - 0.5], [x + 4.2, yy - 0.5], [x, yy + 6.5]]); inked(ctx, '#fffdf2', 1.3); }
        for (const k of [-1, 1]) { circle(ctx, k * 14 + 2 * u, -hh - 8.5, 6); inked(ctx, '#fffdf2', 1.8); ctx.fillStyle = PAL.ink; circle(ctx, k * 14 + 2 * u + 1.4, -hh - 8, 2.5); ctx.fill(); ctx.fillStyle = '#fff'; circle(ctx, k * 14 + 2 * u + 0.5, -hh - 9.2, 0.9); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,120,140,0.5)'; for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(vx + k * (vw + 1), vy + vh + 4.5, 4.2, 2.4, 0, 0, TAU); ctx.fill(); }
      },
    },
    /* ── Oni: horns, tusked jaw, prayer beads, rope belt, tiger cloth ── */
    oni: {
      back(ctx, A, cx, hipY, shY, u) {
        const sway = Math.sin(A.t * 2.2) * 1.5 + A.sway, top = hipY - 3, bot = hipY + 15, w = 19;
        ctx.beginPath(); ctx.moveTo(cx - w, top); ctx.lineTo(cx - w - 1 + sway, bot); hem(ctx, cx - w - 1 + sway, cx + w + 1 + sway, bot, 7, 4, A.t * 2); ctx.lineTo(cx + w, top); ctx.closePath();
        inked(ctx, '#e3ab2f', 2);
        ctx.save(); ctx.clip(); ctx.fillStyle = '#1c1210';
        for (const x of [-14, -5, 4, 13]) poly(ctx, [[cx + x - 2.5, top], [cx + x + 2.5, top], [cx + x + sway * 0.5, top + 11]]), ctx.fill();
        ctx.restore();
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const bw = 15 * (1 - 0.1 * u), yb = hipY + 2, t = A.t;
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(cx - bw - 1, yb - 8); ctx.lineTo(cx + bw + 1, yb - 8); ctx.stroke();          // rope belt
        ctx.strokeStyle = '#dccba0'; ctx.lineWidth = 5.4; ctx.stroke();
        ctx.strokeStyle = 'rgba(90,70,30,0.7)'; ctx.lineWidth = 1; for (let x = cx - bw; x < cx + bw; x += 4) { ctx.beginPath(); ctx.moveTo(x, yb - 5.5); ctx.lineTo(x + 3, yb - 10.5); ctx.stroke(); }
        const kx = cx + bw - 2; ctx.strokeStyle = '#dccba0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(kx, yb - 6); ctx.quadraticCurveTo(kx + 3, yb + 2, kx + Math.sin(t * 3) * 2, yb + 9); ctx.stroke();
        const n = 9;                                                                              // prayer beads
        for (let i = 0; i <= n; i++) { const k = i / n, x = lerp(cx - 18, cx + 18, k), y = shY + 1 + Math.sin(k * Math.PI) * 13, big = i === 4 || i === 5;
          circle(ctx, x, y, big ? 3.6 : 2.9); inked(ctx, big ? '#c8402f' : '#2a1716', 1.2); ctx.fillStyle = 'rgba(255,255,255,0.35)'; circle(ctx, x - 0.9, y - 0.9, 0.8); ctx.fill(); }
      },
      arm(ctx, A, hand) {
        const { E, H } = hand, dx = H.x - E.x, dy = H.y - E.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
        for (const k of [0.55, 0.75]) { const px = lerp(E.x, H.x, k), py = lerp(E.y, H.y, k); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(px - nx * 4.5, py - ny * 4.5); ctx.lineTo(px + nx * 4.5, py + ny * 4.5); ctx.stroke(); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2.4; ctx.stroke(); }
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        for (const [b, d] of [[-16, -1], [15, 1]]) {     // horns
          ctx.beginPath(); ctx.moveTo(b - 6, -hh + 3); ctx.quadraticCurveTo(b - 7 + d * 1, -hh - 13, b + d * 9, -hh - 25); ctx.quadraticCurveTo(b + 3 + d * 2, -hh - 9, b + 6, -hh + 3); ctx.closePath();
          const g = ctx.createLinearGradient(0, -hh - 25, 0, -hh + 3); g.addColorStop(0, '#fff8e6'); g.addColorStop(1, '#bfa877'); inked(ctx, g, 2);
          ctx.strokeStyle = 'rgba(80,60,30,0.5)'; ctx.lineWidth = 1; for (const yy of [-4, -9]) { ctx.beginPath(); ctx.moveTo(b - 5, -hh + yy); ctx.lineTo(b + 5, -hh + yy - 1); ctx.stroke(); }
        }
        ctx.save(); rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();                             // jaw plate
        ctx.beginPath(); ctx.moveTo(-hw - 2, vy + vh - 2); ctx.quadraticCurveTo(vx, vy + vh + 5, hw + 2, vy + vh - 2); ctx.lineTo(hw + 2, hh + 2); ctx.lineTo(-hw - 2, hh + 2); ctx.closePath();
        inked(ctx, '#3a1210', 1.8); ctx.restore();
        for (const k of [-1, 1]) { poly(ctx, [[vx + k * 15 - 3.6, hh - 5], [vx + k * 15 + 3.6, hh - 5], [vx + k * 16.5, vy + vh - 6]]); inked(ctx, IVORY, 1.5); }   // tusks
        ctx.strokeStyle = '#2e0e0d'; ctx.lineWidth = 4.6; ctx.lineCap = 'round';                   // brow
        ctx.beginPath(); ctx.moveTo(vx - vw + 1, vy - vh - 6.5); ctx.lineTo(vx - 4, vy - vh - 1.5); ctx.moveTo(vx + vw - 1, vy - vh - 6.5); ctx.lineTo(vx + 4, vy - vh - 1.5); ctx.stroke();
      },
    },
    /* ── Star drifter: wide hat, duster coat, bandolier, bandana ── */
    drifter: {
      back(ctx, A, cx, hipY, shY, u) {
        const t = A.t, sway = Math.sin(t * 2.2) * 2.4 + A.sway, top = shY + 2, bot = hipY + 26, w = 25 - 2 * u;
        ctx.beginPath(); ctx.moveTo(cx - w + 2, top); ctx.lineTo(cx - w - 6 + sway, bot); hem(ctx, cx - w - 6 + sway, cx + w + 6 + sway, bot, 6, 2.5, t * 3); ctx.lineTo(cx + w - 2, top); ctx.closePath();
        inked(ctx, '#4b3726', 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx, hipY + 4); ctx.lineTo(cx + sway, bot + 1); ctx.stroke();
        ctx.strokeStyle = 'rgba(214,176,120,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx - w + 4, top + 3); ctx.lineTo(cx - w - 3 + sway, bot - 3); ctx.moveTo(cx + w - 4, top + 3); ctx.lineTo(cx + w + 3 + sway, bot - 3); ctx.stroke();
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const t = A.t, tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2;
        ctx.save(); torsoPath(ctx, cx, shY, yb, tw, bw); ctx.clip();
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 7.5; ctx.beginPath(); ctx.moveTo(cx - tw, shY + 3); ctx.lineTo(cx + bw + 1, yb - 7); ctx.stroke();
        ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 5; ctx.stroke();
        for (const k of [0.3, 0.5, 0.7]) { const x = lerp(cx - tw, cx + bw + 1, k), y = lerp(shY + 3, yb - 7, k); ctx.fillStyle = '#e8a13a'; rr(ctx, x - 1.6, y - 3.2, 3.2, 6.4, 1.2); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 0.9; ctx.stroke(); }
        ctx.restore();
        const s2 = Math.sin(t * 3.4) * 3;                                                         // bandana + tail
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(cx - 14, shY + 1); ctx.quadraticCurveTo(cx - 24, shY + 3 + s2 * 0.5, cx - 31, shY + 9 + s2); ctx.stroke(); ctx.strokeStyle = '#c8402f'; ctx.lineWidth = 3.8; ctx.stroke();
        poly(ctx, [[cx - 16, shY - 3], [cx + 18, shY - 3], [cx + 3 + 3 * u, shY + 12]]); inked(ctx, '#c8402f', 1.8);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 9, shY + 1); ctx.lineTo(cx + 3 + 3 * u, shY + 8); ctx.lineTo(cx + 12, shY + 1); ctx.stroke();
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        ctx.save(); if (A.eyes.mode === 'sleep') { ctx.translate(3, 12); ctx.rotate(0.3); }
        const by = -hh + 4, ax = -3 * u;
        ctx.beginPath(); ctx.moveTo(-47, by - 4); ctx.quadraticCurveTo(-28, by + 7, ax, by + 5); ctx.quadraticCurveTo(28, by + 7, 47, by - 4); ctx.quadraticCurveTo(26, by - 1, ax, by - 2); ctx.quadraticCurveTo(-26, by - 1, -47, by - 4); ctx.closePath();
        inked(ctx, '#6b4a2e', 2.2);
        ctx.beginPath(); ctx.moveTo(ax - 23, by - 1); ctx.lineTo(ax - 19, by - 17); ctx.quadraticCurveTo(ax - 9, by - 23, ax, by - 17.5); ctx.quadraticCurveTo(ax + 9, by - 23, ax + 19, by - 17); ctx.lineTo(ax + 23, by - 1); ctx.quadraticCurveTo(ax, by + 2, ax - 23, by - 1); ctx.closePath();
        const g = ctx.createLinearGradient(0, by - 22, 0, by); g.addColorStop(0, '#8a6340'); g.addColorStop(1, '#5d3f27'); inked(ctx, g, 2.2);
        ctx.beginPath(); ctx.moveTo(ax - 22.5, by - 2); ctx.quadraticCurveTo(ax, by + 1, ax + 22.5, by - 2); ctx.lineTo(ax + 21.5, by - 7); ctx.quadraticCurveTo(ax, by - 4.5, ax - 21.5, by - 7); ctx.closePath(); ctx.fillStyle = '#231710'; ctx.fill();
        ctx.fillStyle = '#e8a13a'; hexPath(ctx, ax + 9, by - 4, 2.6); ctx.fill();
        ctx.fillStyle = 'rgba(10,14,21,0.45)'; ctx.beginPath(); ctx.moveTo(-36, by + 3); ctx.quadraticCurveTo(0, by + 6, 36, by + 3); ctx.lineTo(30, by + 8); ctx.quadraticCurveTo(0, by + 10, -30, by + 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      },
    },
    /* ── Pirate captain: tricorn, eyepatch, long coat, sash, parrot ── */
    pirate: {
      back(ctx, A, cx, hipY, shY, u) {
        const sway = cloak(ctx, A, cx, shY + 2, hipY + 25, 23 - 2 * u, 30 - 2 * u, '#1c2540', 6, 2.5), w = 30 - 2 * u, bot = hipY + 25;
        ctx.strokeStyle = 'rgba(232,193,92,0.85)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx - 21, shY + 5); ctx.lineTo(cx - w + 3 + sway, bot - 3); ctx.moveTo(cx + 21, shY + 5); ctx.lineTo(cx + w - 3 + sway, bot - 3); ctx.stroke();
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const t = A.t, tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2;
        ctx.save(); torsoPath(ctx, cx, shY, yb, tw, bw); ctx.clip();
        for (const k of [-1, 1]) { poly(ctx, [[cx + k * (tw + 2), shY - 2], [cx + k * 6 + 3 * u, shY + 2], [cx + k * (bw - 2), yb - 12], [cx + k * (tw + 2), yb - 10]]); inked(ctx, '#1c2540', 1.6);
          ctx.fillStyle = GLD; for (const y of [8, 15, 22]) { circle(ctx, cx + k * (tw - 5) - k * (y * 0.14), shY + y, 1.3); ctx.fill(); } }
        ctx.restore();
        ctx.fillStyle = CRIM; rr(ctx, cx - bw - 0.5, yb - 10, bw * 2 + 1, 6.5, 2); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
        const kx = cx - bw + 3; ctx.lineCap = 'round';
        for (const [col, lw] of [[PAL.ink, 5], [CRIM, 3.2]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(kx, yb - 5); ctx.quadraticCurveTo(kx - 3, yb + 4, kx - 2 + Math.sin(t * 3) * 2.4, yb + 12); ctx.stroke(); }
        hexPath(ctx, cx + 3 * u, yb - 6.8, 3.2); inked(ctx, GLD, 1.2);
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-hw + 2, -hh + 8); ctx.lineTo(hw - 2, vy + 4); ctx.stroke();       // eyepatch strap + patch
        ctx.beginPath(); ctx.ellipse(vx + vw * 0.48, vy - 0.5, 8.2, 7.6, 0, 0, TAU); inked(ctx, '#11131a', 1.6);
        ctx.save(); if (A.eyes.mode === 'sleep') { ctx.translate(3, 11); ctx.rotate(0.28); }
        const by = -hh + 5, ax = -3 * u;
        ctx.beginPath(); ctx.ellipse(ax, by - 9, 21, 12, 0, Math.PI, TAU); ctx.lineTo(ax + 21, by); ctx.lineTo(ax - 21, by); ctx.closePath(); inked(ctx, '#15161d', 2);   // crown
        ctx.beginPath(); ctx.moveTo(ax - 46, by + 1); ctx.quadraticCurveTo(ax - 36, by - 17, ax - 15, by - 11); ctx.quadraticCurveTo(ax, by - 23, ax + 15, by - 11); ctx.quadraticCurveTo(ax + 36, by - 17, ax + 46, by + 1);
        ctx.quadraticCurveTo(ax + 22, by + 8, ax, by + 7); ctx.quadraticCurveTo(ax - 22, by + 8, ax - 46, by + 1); ctx.closePath(); inked(ctx, '#1d1e27', 2.2);
        ctx.strokeStyle = GLD; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(ax - 43, by - 1); ctx.quadraticCurveTo(ax - 35, by - 14, ax - 15, by - 8.5); ctx.quadraticCurveTo(ax, by - 20, ax + 15, by - 8.5); ctx.quadraticCurveTo(ax + 35, by - 14, ax + 43, by - 1); ctx.stroke();
        circle(ctx, ax, by - 2.5, 4.6); inked(ctx, IVORY, 1.3); ctx.fillStyle = PAL.ink; circle(ctx, ax - 1.7, by - 3.2, 1.1); ctx.fill(); circle(ctx, ax + 1.7, by - 3.2, 1.1); ctx.fill(); ctx.fillRect(ax - 1.8, by - 0.6, 3.6, 1.1);
        const s = Math.sin(A.t * 2.6) * 2;                                                          // feather
        ctx.beginPath(); ctx.moveTo(ax - 16, by - 11); ctx.quadraticCurveTo(ax - 30, by - 34 + s, ax - 50 + s, by - 24); ctx.quadraticCurveTo(ax - 32, by - 20, ax - 20, by - 8); ctx.closePath(); inked(ctx, CRIM, 1.8);
        ctx.restore();
        const fl = A.sig && A.sig.kind === 'pirate' ? A.sig.p : -1, fa = fl * TAU, fe = fl >= 0 ? Math.sin(Math.PI * fl) : 0;
        const px = -hw - 9 + (fl >= 0 ? (1 - Math.cos(fa)) * 44 : 0), py = hh + 2 + Math.sin(A.t * 3) * 0.8 - (fl >= 0 ? Math.sin(fa) * 46 + fe * 30 : 0);
        if (fe > 0.05) { const f = Math.sin(A.t * 30) * 7; poly(ctx, [[px - 2, py + 1], [px - 15, py - 6 - f], [px - 4, py + 6]]); inked(ctx, '#2fbf71', 1.3); poly(ctx, [[px + 2, py + 1], [px + 13, py - 6 + f], [px + 3, py + 6]]); inked(ctx, '#2fbf71', 1.3); }                                 // parrot on the far shoulder
        ctx.beginPath(); ctx.moveTo(px - 2, py + 6); ctx.lineTo(px - 9, py + 17); ctx.lineTo(px + 1, py + 9); ctx.closePath(); inked(ctx, '#2a7de1', 1.4);
        ctx.beginPath(); ctx.ellipse(px, py + 2, 6, 8, -0.15, 0, TAU); inked(ctx, '#e0334f', 1.6);
        ctx.beginPath(); ctx.ellipse(px - 2.5, py + 4, 3.4, 5.6, -0.3, 0, TAU); inked(ctx, '#2fbf71', 1.2);
        circle(ctx, px + 1, py - 6, 5); inked(ctx, '#e0334f', 1.6);
        { const open = clamp(A.eyes.talk * 3, 0, 1) * (0.5 + 0.5 * Math.sin(A.t * 18)) * 2.6; poly(ctx, [[px + 4.5, py - 7.5], [px + 10.5, py - 5.6 - open * 0.5], [px + 4.5, py - 4.6]]); inked(ctx, '#ffd84a', 1.2); poly(ctx, [[px + 4.5, py - 4.4], [px + 9, py - 3.6 + open], [px + 4.5, py - 2.6]]); inked(ctx, '#f0b429', 1.1); }
        ctx.fillStyle = '#fff'; circle(ctx, px + 2, py - 7, 1.9); ctx.fill(); ctx.fillStyle = PAL.ink; circle(ctx, px + 2.5, py - 7, 0.9); ctx.fill();
      },
    },
    /* ── Vampire: high-collar cape, widow's peak, fangs, cravat, bat ── */
    vampire: {
      back(ctx, A, cx, hipY, shY, u) {
        const sway = cloak(ctx, A, cx, shY + 1, hipY + 27, 22, 34 - 2 * u, '#14121d', 5, 6), bot = hipY + 27;
        ctx.save(); ctx.beginPath(); ctx.moveTo(cx - 15, shY + 4); ctx.lineTo(cx - 24 + sway, bot - 4); ctx.lineTo(cx + 24 + sway, bot - 4); ctx.lineTo(cx + 15, shY + 4); ctx.closePath(); ctx.fillStyle = '#8f1730'; ctx.fill(); ctx.restore();
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2, mx = cx + 3 * u;
        ctx.save(); torsoPath(ctx, cx, shY, yb, tw, bw); ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(mx, shY + 18); ctx.lineTo(mx, yb - 6); ctx.stroke();
        ctx.fillStyle = GLD; for (const y of [22, 28]) { circle(ctx, mx + 3, shY + y, 1.2); ctx.fill(); }
        ctx.restore();
        for (const [w, y] of [[9, 1], [7, 6]]) { ctx.beginPath(); ctx.moveTo(mx - w, shY + y); ctx.quadraticCurveTo(mx, shY + y - 3, mx + w, shY + y); ctx.quadraticCurveTo(mx + w * 0.6, shY + y + 8, mx, shY + y + 9); ctx.quadraticCurveTo(mx - w * 0.6, shY + y + 8, mx - w, shY + y); ctx.closePath(); inked(ctx, '#f6f3ea', 1.4); }
        ctx.save(); ctx.shadowColor = CRIM; ctx.shadowBlur = 8; hexPath(ctx, mx, shY + 2.5, 3.2); ctx.fillStyle = '#ff3355'; ctx.fill(); ctx.restore(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.2; hexPath(ctx, mx, shY + 2.5, 3.2); ctx.stroke();
        let wrap = A.eyes.mode === 'sleep' ? 1 : 0;
        if (A.sig && A.sig.kind === 'vampire') { const tt = A.sig.t; wrap = tt < 1.25 ? smooth(clamp(tt / 0.35, 0, 1)) : 1 - smooth(clamp((tt - 1.25) / 0.2, 0, 1)); }
        if (wrap > 0.02) {
          const top = shY - 1, bot = hipY + 27, sway = Math.sin(A.t * 2.1) * 2.2 + A.sway;
          for (const k of [-1, 1]) {
            const edge = lerp(cx + k * (tw + 5), mx - k * 2.5, wrap);
            ctx.beginPath(); ctx.moveTo(cx + k * (tw + 4), top); ctx.lineTo(edge, top + 3); ctx.lineTo(edge + sway * 0.6, bot); ctx.lineTo(cx + k * 33 + sway, bot); ctx.closePath(); inked(ctx, '#14121d', 2);
            ctx.strokeStyle = 'rgba(200,36,63,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(edge, top + 4); ctx.lineTo(edge + sway * 0.6, bot - 1); ctx.stroke();
          }
        }
      },
      headBack(ctx, A, hw, hh) {
        for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * (hw - 9), hh + 3); ctx.lineTo(k * (hw + 13), -hh - 5); ctx.quadraticCurveTo(k * (hw + 8), 4, k * (hw + 4), hh + 5); ctx.closePath(); inked(ctx, '#14121d', 2.2);
          ctx.beginPath(); ctx.moveTo(k * (hw - 5), hh + 2); ctx.lineTo(k * (hw + 9.5), -hh + 2); ctx.quadraticCurveTo(k * (hw + 5), 6, k * (hw + 2), hh + 3); ctx.closePath(); ctx.fillStyle = '#8f1730'; ctx.fill(); }
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        const t = A.t;
        ctx.save(); rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();                                // slicked hair with a widow's peak
        ctx.beginPath(); ctx.moveTo(-hw - 2, -hh - 2); ctx.lineTo(hw + 2, -hh - 2); ctx.lineTo(hw + 2, -hh + 9); ctx.quadraticCurveTo(vx + 12, -hh + 5, vx, vy - vh - 1); ctx.quadraticCurveTo(vx - 12, -hh + 5, -hw - 2, -hh + 9); ctx.closePath();
        inked(ctx, '#15131e', 1.8);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-12, -hh + 2.5); ctx.quadraticCurveTo(2, -hh + 0.5, 14, -hh + 3.5); ctx.stroke();
        ctx.restore();
        for (const k of [-1, 1]) { poly(ctx, [[vx + k * 7 - 2.4, vy + vh + 0.5], [vx + k * 7 + 2.4, vy + vh + 0.5], [vx + k * 7, vy + vh + 7.5]]); inked(ctx, '#fffdf2', 1.3); }
        const zz = A.eyes.mode === 'sleep', bx = hw + 24 + (zz ? 0 : Math.sin(t * 1.3) * 5), by2 = -hh - 2 + (zz ? 6 : Math.sin(t * 2.7) * 4), f = zz ? -4 : Math.sin(t * 16) * 5;                                      // bat
        for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(bx, by2); ctx.quadraticCurveTo(bx + k * 7, by2 - 7 - f, bx + k * 14, by2 - 1 - f * 0.6); ctx.quadraticCurveTo(bx + k * 10, by2 + 1, bx + k * 8.5, by2 + 4 - f * 0.3); ctx.quadraticCurveTo(bx + k * 5, by2 + 1, bx, by2 + 4); ctx.closePath(); inked(ctx, '#2a2438', 1.4); }
        circle(ctx, bx, by2 + 0.5, 3.6); inked(ctx, '#2a2438', 1.4); poly(ctx, [[bx - 3, by2 - 2], [bx - 2.4, by2 - 6], [bx - 0.6, by2 - 2.8]]); ctx.fill(); poly(ctx, [[bx + 3, by2 - 2], [bx + 2.4, by2 - 6], [bx + 0.6, by2 - 2.8]]); ctx.fill();
        ctx.fillStyle = '#ff3355'; circle(ctx, bx - 1.3, by2, 0.8); ctx.fill(); circle(ctx, bx + 1.3, by2, 0.8); ctx.fill();
      },
    },
    /* ── Reaper: tattered black hood and cloak, skull jaw, scythe, soul flame ── */
    reaper: {
      back(ctx, A, cx, hipY, shY, u) { cloak(ctx, A, cx, shY + 1, hipY + 29, 23, 30 - 2 * u, '#121218', 9, 6); },
      torso(ctx, A, cx, hipY, shY, u) {
        const tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2, mx = cx + 3 * u;
        for (const k of [-1, 1]) { poly(ctx, [[cx + k * (tw + 3), shY - 3], [cx + k * 5 + 3 * u, shY + 1], [cx + k * 9, yb - 4], [cx + k * (bw + 4), yb + 3], [cx + k * (tw + 5), shY + 14]]); inked(ctx, '#17171f', 1.8); }
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(mx - 6, shY + 3); ctx.lineTo(mx, shY + 8); ctx.lineTo(mx + 6, shY + 3); ctx.stroke();
        ctx.strokeStyle = '#8a7a52'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(cx - bw - 3, yb - 9); ctx.lineTo(cx + bw + 3, yb - 9); ctx.stroke();
      },
      arm(ctx, A, hand) {
        const { H } = hand, t = A.t, tx = H.x + 3, ty = H.y - 58;
        ctx.lineCap = 'round'; for (const [col, lw] of [[PAL.ink, 5.2], ['#4a3a2a', 3.2]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(H.x + 5, H.y + 26); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(tx + 2, ty + 2); ctx.quadraticCurveTo(tx + 24, ty - 9, tx + 40, ty + 16); ctx.quadraticCurveTo(tx + 22, ty + 3, tx + 1, ty + 9); ctx.closePath();
        const g = ctx.createLinearGradient(tx, 0, tx + 40, 0); g.addColorStop(0, '#8f99a8'); g.addColorStop(1, '#f4f7fb'); inked(ctx, g, 2);
        ctx.save(); ctx.shadowColor = TEAL; ctx.shadowBlur = 9; ctx.strokeStyle = TEAL; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 3); ctx.beginPath(); ctx.moveTo(tx + 38, ty + 14); ctx.quadraticCurveTo(tx + 22, ty + 2.5, tx + 2, ty + 8.5); ctx.stroke(); ctx.restore();
      },
      headBack(ctx, A, hw, hh) {
        const s = Math.sin(A.t * 2.4) * 2;
        ctx.beginPath(); ctx.moveTo(-hw - 8, hh + 9); ctx.quadraticCurveTo(-hw - 12, -hh - 4, -14, -hh - 12); ctx.quadraticCurveTo(-24, -hh - 26 + s, -hw - 22 + s, -hh - 18); ctx.quadraticCurveTo(-8, -hh - 30, 12, -hh - 12);
        ctx.quadraticCurveTo(hw + 12, -hh - 4, hw + 8, hh + 9); ctx.closePath(); inked(ctx, '#121218', 2.2);
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        const t = A.t;
        ctx.save(); ctx.beginPath(); ctx.moveTo(-hw - 9, hh + 10); ctx.quadraticCurveTo(-hw - 13, -hh - 5, -14, -hh - 13); ctx.lineTo(12, -hh - 13); ctx.quadraticCurveTo(hw + 13, -hh - 5, hw + 9, hh + 10); ctx.closePath(); ctx.clip();
        ctx.beginPath(); ctx.moveTo(-hw - 12, hh + 12); ctx.lineTo(-hw - 12, -hh - 14); ctx.lineTo(hw + 12, -hh - 14); ctx.lineTo(hw + 12, hh + 12);
        ctx.lineTo(hw - 3, hh + 12); ctx.quadraticCurveTo(hw + 1, -hh + 4, 0, -hh + 5); ctx.quadraticCurveTo(-hw - 1, -hh + 4, -hw + 3, hh + 12); ctx.closePath();
        inked(ctx, '#1b1b24', 2); ctx.restore();
        ctx.save(); rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();                                // skull jaw
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(vx - 13, vy + vh + 3.2); ctx.lineTo(vx + 13, vy + vh + 3.2); ctx.stroke();
        for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(vx + i * 3.8, vy + vh + 1); ctx.lineTo(vx + i * 3.8, vy + vh + 7.5); ctx.stroke(); }
        ctx.restore();
        const big = A.eyes.mode === 'think' ? 1.5 : 1, fx = -hw - 24, fy = -hh + 8 + Math.sin(t * 2.3) * 4;                                    // soul flame
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.shadowColor = TEAL; ctx.shadowBlur = 14;
        const g = ctx.createLinearGradient(0, fy - 11, 0, fy + 5); g.addColorStop(0, 'rgba(125,249,201,0)'); g.addColorStop(0.5, 'rgba(125,249,201,0.9)'); g.addColorStop(1, 'rgba(220,255,245,0.95)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(fx + Math.sin(t * 7) * 1.5, fy - 12 * big); ctx.quadraticCurveTo(fx + 6 * big, fy - 2, fx, fy + 5); ctx.quadraticCurveTo(fx - 6 * big, fy - 2, fx, fy - 12 * big); ctx.fill(); ctx.restore();
        ctx.fillStyle = PAL.ink; circle(ctx, fx - 1.6, fy - 0.5, 0.9); ctx.fill(); circle(ctx, fx + 1.6, fy - 0.5, 0.9); ctx.fill();
      },
    },
    /* ── Shark: onesie with dorsal fin, toothy hood, white belly, tail ── */
    shark: {
      back(ctx, A, cx, hipY, shY, u) {
        const t = A.t, wag = clamp(A.eyes.talk * 3, 0, 1), s = Math.sin(t * (3 + 7 * wag)) * (3 + 3 * wag) + A.sway * 1.5, bx = cx - 40, by = hipY + 2 + s * 0.6;
        ctx.beginPath(); ctx.moveTo(cx - 8, hipY - 9); ctx.quadraticCurveTo(cx - 26, hipY - 6, bx, by); ctx.lineTo(bx - 14, by - 15 + s * 0.5); ctx.quadraticCurveTo(bx - 9, by + 1, bx - 12, by + 14 + s * 0.5); ctx.lineTo(bx + 2, by + 5); ctx.quadraticCurveTo(cx - 22, hipY + 8, cx - 6, hipY + 6); ctx.closePath();
        inked(ctx, '#6a9bc2', 2.2);
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2;
        ctx.save(); torsoPath(ctx, cx, shY, yb, tw, bw); ctx.clip();
        ctx.fillStyle = '#f4f8fb'; ctx.beginPath(); ctx.ellipse(cx + 4 * u, shY + 21, 12, 18, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();
      },
      arm(ctx, A, hand) {
        const { S, E } = hand, mx = (S.x + E.x) / 2, my = (S.y + E.y) / 2;
        poly(ctx, [[mx + 2, my - 3], [mx + 13, my + 6], [mx + 3, my + 5]]); inked(ctx, '#4e7da3', 1.5);
      },
      headBack(ctx, A, hw, hh) {
        ctx.beginPath(); ctx.moveTo(-14, -hh - 6); ctx.quadraticCurveTo(-10, -hh - 26, -22, -hh - 33); ctx.quadraticCurveTo(6, -hh - 30, 13, -hh - 6); ctx.closePath(); inked(ctx, '#4e7da3', 2.2);   // dorsal fin
        rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 17, 21); inked(ctx, '#6a9bc2', 2.2);
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        ctx.save(); rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 17, 21); ctx.clip();
        ctx.beginPath(); ctx.moveTo(-hw - 8, 6); ctx.lineTo(-hw - 8, -hh - 10); ctx.lineTo(hw + 8, -hh - 10); ctx.lineTo(hw + 8, 6);
        ctx.lineTo(hw - 2, 6); ctx.quadraticCurveTo(hw - 2, -hh + 5, 0, -hh + 5); ctx.quadraticCurveTo(-hw + 2, -hh + 5, -hw + 2, 6); ctx.closePath();
        inked(ctx, '#7fb0d4', 2);
        ctx.fillStyle = '#f4f8fb'; ctx.fillRect(-hw - 8, hh - 4, hw * 2 + 16, 14); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-hw - 8, hh - 4); ctx.lineTo(hw + 8, hh - 4); ctx.stroke();
        ctx.restore();
        for (const x of [-20, -12, -4, 4, 12, 20]) { const yy = -hh + 5 + (Math.abs(x) > 15 ? 2.4 : Math.abs(x) > 8 ? 0.7 : 0); poly(ctx, [[x - 3.6, yy - 0.5], [x + 3.6, yy - 0.5], [x, yy + 6]]); inked(ctx, '#fffdf2', 1.2); }
        for (const k of [-1, 1]) { ctx.fillStyle = PAL.ink; circle(ctx, k * (hw - 1) + 2 * u, -hh - 1.5, 2.6); ctx.fill(); ctx.fillStyle = '#fff'; circle(ctx, k * (hw - 1) + 2 * u - 0.8, -hh - 2.4, 0.9); ctx.fill(); }
        ctx.strokeStyle = 'rgba(20,40,60,0.55)'; ctx.lineWidth = 1.4; for (const dx of [0, 3.2, 6.4]) { ctx.beginPath(); ctx.moveTo(-hw - 3 + dx * 0.3, 6 + dx); ctx.lineTo(-hw + 1.5 + dx * 0.3, 7 + dx); ctx.stroke(); }
        if (A.sig && A.sig.kind === 'shark') {
          const tt = A.sig.t, pulse = (a) => (tt > a && tt < a + 0.26 ? Math.sin(((tt - a) / 0.26) * Math.PI) : 0), bite = Math.max(pulse(1.1), pulse(1.55));
          if (bite > 0.02) {
            const jy = lerp(hh + 4, -hh + 12, bite);
            ctx.save(); rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 17, 21); ctx.clip();
            ctx.fillStyle = '#7fb0d4'; ctx.fillRect(-hw - 8, jy + 5, hw * 2 + 16, hh * 2 + 20); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-hw - 8, jy + 5); ctx.lineTo(hw + 8, jy + 5); ctx.stroke();
            ctx.restore();
            for (const x of [-16, -8, 0, 8, 16]) { poly(ctx, [[x - 3.6, jy + 5.5], [x + 3.6, jy + 5.5], [x, jy - 1]]); inked(ctx, '#fffdf2', 1.2); }
          }
        }
      },
    },
    /* ── Pharaoh: striped nemes, cobra, jewelled collar, kilt ── */
    pharaoh: {
      back(ctx, A, cx, hipY, shY, u) {
        const sway = Math.sin(A.t * 2.2) * 1.2 + A.sway, top = hipY - 4, bot = hipY + 15, w = 19;
        ctx.beginPath(); ctx.moveTo(cx - w, top); ctx.lineTo(cx - w - 2 + sway, bot); ctx.lineTo(cx + w + 2 + sway, bot); ctx.lineTo(cx + w, top); ctx.closePath(); inked(ctx, '#fbf7ec', 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; for (const x of [-12, -6, 6, 12]) { ctx.beginPath(); ctx.moveTo(cx + x, top + 2); ctx.lineTo(cx + x * 1.08 + sway, bot - 1); ctx.stroke(); }
        poly(ctx, [[cx - 4 + 3 * u, top], [cx + 4 + 3 * u, top], [cx + 5 + 3 * u + sway, bot + 3], [cx - 5 + 3 * u + sway, bot + 3]]); inked(ctx, LAPIS, 1.6);
        ctx.fillStyle = GLD; for (const y of [5, 11, 17]) ctx.fillRect(cx - 4.5 + 3 * u + sway * (y / 20), top + y, 9, 2);
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const bw = 15 * (1 - 0.1 * u), yb = hipY + 2, mx = cx + 2 * u;
        for (const [r, col] of [[19, GLD], [14.5, LAPIS], [10.5, '#d8403a'], [6.5, GLD]]) { ctx.beginPath(); ctx.moveTo(mx - r - 1, shY - 2); ctx.quadraticCurveTo(mx, shY + r * 1.25, mx + r + 1, shY - 2); ctx.closePath(); inked(ctx, col, 1.3); }
        ctx.fillStyle = GLD; rr(ctx, cx - bw - 1, yb - 10, bw * 2 + 2, 6, 2); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.save(); ctx.shadowColor = '#33c6d9'; ctx.shadowBlur = 6; ctx.fillStyle = '#33c6d9'; hexPath(ctx, mx + 1, yb - 7, 2.6); ctx.fill(); ctx.restore();
      },
      arm(ctx, A, hand) {
        const { E, H } = hand, dx = H.x - E.x, dy = H.y - E.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
        for (const [k, col] of [[0.5, LAPIS], [0.72, '#33c6d9']]) { const px = lerp(E.x, H.x, k), py = lerp(E.y, H.y, k); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(px - nx * 4.6, py - ny * 4.6); ctx.lineTo(px + nx * 4.6, py + ny * 4.6); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.stroke(); }
      },
      headBack(ctx, A, hw, hh) {
        ctx.beginPath(); ctx.moveTo(-10, -hh - 9); ctx.quadraticCurveTo(-hw - 16, -hh - 6, -hw - 17, 8); ctx.lineTo(-hw - 9, hh + 16); ctx.lineTo(-hw + 6, hh + 16); ctx.lineTo(-hw + 4, 0);
        ctx.lineTo(hw - 4, 0); ctx.lineTo(hw - 6, hh + 16); ctx.lineTo(hw + 9, hh + 16); ctx.lineTo(hw + 17, 8); ctx.quadraticCurveTo(hw + 16, -hh - 6, 10, -hh - 9); ctx.closePath();
        inked(ctx, GLD, 2.2);
        ctx.save(); ctx.clip(); ctx.fillStyle = LAPIS; for (let y = -hh - 8; y < hh + 18; y += 7.5) ctx.fillRect(-hw - 20, y, hw * 2 + 40, 3.6); ctx.restore();
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        ctx.save(); rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();
        ctx.beginPath(); ctx.moveTo(-hw - 2, -hh - 2); ctx.lineTo(hw + 2, -hh - 2); ctx.lineTo(hw + 2, -hh + 8); ctx.quadraticCurveTo(vx, -hh + 4, -hw - 2, -hh + 8); ctx.closePath(); inked(ctx, GLD, 1.6);
        ctx.save(); ctx.clip(); ctx.fillStyle = LAPIS; for (let x = -hw; x < hw + 4; x += 8) { poly(ctx, [[x, -hh - 2], [x + 3.4, -hh - 2], [x + 1.4 + (x - vx) * 0.08, -hh + 9], [x - 2 + (x - vx) * 0.08, -hh + 9]]); ctx.fill(); } ctx.restore();
        ctx.restore();
        const sx = vx, sy = -hh + 2;                                                                // cobra
        ctx.beginPath(); ctx.moveTo(sx - 2.5, sy + 4); ctx.quadraticCurveTo(sx - 8, sy - 6, sx - 3, sy - 13); ctx.quadraticCurveTo(sx, sy - 16, sx + 3, sy - 13); ctx.quadraticCurveTo(sx + 8, sy - 6, sx + 2.5, sy + 4); ctx.closePath(); inked(ctx, GLD, 1.6);
        ctx.fillStyle = '#d8403a'; circle(ctx, sx, sy - 8, 1.5); ctx.fill(); ctx.fillStyle = PAL.ink; circle(ctx, sx - 1.5, sy - 12, 0.7); ctx.fill(); circle(ctx, sx + 1.5, sy - 12, 0.7); ctx.fill();
        rr(ctx, vx - 3.2, hh - 1, 6.4, 12, 2.4); inked(ctx, LAPIS, 1.5);                              // ceremonial beard
        ctx.strokeStyle = GLD; ctx.lineWidth = 1.2; for (const y of [3, 6.5]) { ctx.beginPath(); ctx.moveTo(vx - 3, hh - 1 + y); ctx.lineTo(vx + 3, hh - 1 + y); ctx.stroke(); }
      },
    },
    /* ── Knight: plumed helm, blue cape, tabard, kite shield ── */
    knight: {
      back(ctx, A, cx, hipY, shY, u) {
        const sway = cloak(ctx, A, cx, shY + 1, hipY + 24, 21, 28 - 2 * u, '#1f4fa3', 5, 2);
        ctx.strokeStyle = 'rgba(232,193,92,0.9)'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(cx - 28 + 2 * u + sway, hipY + 20); ctx.lineTo(cx + 28 - 2 * u + sway, hipY + 20); ctx.stroke();
      },
      torso(ctx, A, cx, hipY, shY, u) {
        const bw = 15 * (1 - 0.1 * u), yb = hipY + 2, mx = cx + 3 * u, s = Math.sin(A.t * 2.4) * 1;
        poly(ctx, [[mx - 9, shY + 16], [mx + 9, shY + 16], [mx + 10 + s, yb + 9], [mx + s, yb + 13], [mx - 10 + s, yb + 9]]); inked(ctx, '#1f4fa3', 1.8);
        ctx.strokeStyle = GLD; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx - 5, yb - 4); ctx.lineTo(mx + s * 0.5, yb + 2); ctx.lineTo(mx + 5, yb - 4); ctx.stroke();
        ctx.fillStyle = '#5a4630'; rr(ctx, cx - bw - 1, yb - 12, bw * 2 + 2, 4.5, 1.5); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.fillStyle = GLD; rr(ctx, mx - 3, yb - 13, 6, 6.5, 1.2); ctx.fill(); ctx.stroke();
      },
      arm(ctx, A, hand) {
        const { E, H } = hand, x = (E.x + H.x) / 2 + 3, y = (E.y + H.y) / 2 - 2;
        ctx.beginPath(); ctx.moveTo(x - 12, y - 15); ctx.lineTo(x + 12, y - 15); ctx.quadraticCurveTo(x + 13, y + 6, x, y + 19); ctx.quadraticCurveTo(x - 13, y + 6, x - 12, y - 15); ctx.closePath();
        const g = ctx.createLinearGradient(x - 12, 0, x + 12, 0); g.addColorStop(0, '#2a62c4'); g.addColorStop(1, '#173d82'); inked(ctx, g, 2.2);
        ctx.save(); ctx.clip(); ctx.strokeStyle = GLD; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(x - 14, y - 6); ctx.lineTo(x, y + 4); ctx.lineTo(x + 14, y - 6); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = 'rgba(232,193,92,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 10, y - 13); ctx.lineTo(x + 10, y - 13); ctx.stroke();
      },
      headBack(ctx, A, hw, hh) {
        const s = Math.sin(A.t * 2.6) * 2 + A.sway;                                                  // plume
        ctx.beginPath(); ctx.moveTo(8, -hh - 2); ctx.quadraticCurveTo(6, -hh - 24, -14, -hh - 25); ctx.quadraticCurveTo(-hw - 12 + s, -hh - 22, -hw - 16 + s, -hh + 6); ctx.quadraticCurveTo(-hw - 2, -hh - 8, -10, -hh - 4); ctx.closePath();
        inked(ctx, CRIM, 2.2);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(2, -hh - 12); ctx.quadraticCurveTo(-12, -hh - 20, -hw - 8 + s, -hh - 6); ctx.stroke();
      },
      head(ctx, A, hw, hh, vx, vy, vw, vh, u) {
        rr(ctx, -6, -hh - 5, 14, 7, 2.5); inked(ctx, GLD, 1.6);                                       // plume socket
        ctx.save(); rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 6.5; ctx.beginPath(); ctx.moveTo(-hw - 2, vy - vh - 4.5); ctx.quadraticCurveTo(vx, vy - vh - 8.5, hw + 2, vy - vh - 4.5); ctx.stroke(); ctx.strokeStyle = GLD; ctx.lineWidth = 3.6; ctx.stroke();   // brow band
        ctx.restore();
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = 5.5; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(vx, vy - vh - 7); ctx.lineTo(vx, vy + vh + 3); ctx.stroke(); ctx.strokeStyle = PAL.armor; ctx.lineWidth = 3; ctx.stroke(); ctx.lineCap = 'round';   // nasal bar
        for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(vx + k * (vw + 1.5), vy + 2); ctx.lineTo(vx + k * (vw + 4), hh - 1); ctx.lineTo(vx + k * 9, hh - 1); ctx.quadraticCurveTo(vx + k * 12, vy + vh + 3, vx + k * (vw - 3), vy + vh + 1.5); ctx.closePath(); inked(ctx, PAL.armor, 1.6); }   // cheek guards
      },
    },
  };

  // wavy hem helper: polyline from (x0,y) to (x1,y) with n teeth of depth d, phase ph
  function hem(ctx, x0, x1, y, n, d, ph) {
    for (let i = 0; i <= n; i++) { const k = i / n; ctx.lineTo(lerp(x0, x1, k), y + (i % 2 ? d : 0) + Math.sin(ph + k * 6) * 1.2); }
  }

  // Hook: after the legs, before the torso — things that hang from the shoulders.
  function outfitBack(ctx, A, cx, hipY, shY, u, C) {
    { const X = XO[A.outfit]; if (X) { if (X.back) X.back(ctx, A, cx, hipY, shY, u, C); return; } }
    const O = A.outfit, t = A.t, sway = Math.sin(t * 2.2) * 2 + A.sway;
    if (O === 'ronin') {                               // haori: dark coat with a frayed hem and red lining
      const top = shY + 2, bot = hipY + 16, w = 24 - 2 * u;
      ctx.beginPath(); ctx.moveTo(cx - w + 1, top); ctx.lineTo(cx - w - 3 + sway, bot);
      hem(ctx, cx - w - 3 + sway, cx + w + 3 + sway, bot, 8, 3, t * 3);
      ctx.lineTo(cx + w - 1, top); ctx.closePath();
      ctx.fillStyle = '#1a1424'; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(224,83,63,0.75)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx - w + 3, top + 2); ctx.lineTo(cx - w - 1 + sway, bot - 2); ctx.moveTo(cx + w - 3, top + 2); ctx.lineTo(cx + w + 1 + sway, bot - 2); ctx.stroke();
    } else if (O === 'spirit') {                       // pale robe down over the hips
      const top = shY + 3, bot = hipY + 18, w = 23 - 2 * u;
      ctx.beginPath(); ctx.moveTo(cx - w + 2, top); ctx.lineTo(cx - w - 2 + sway, bot);
      hem(ctx, cx - w - 2 + sway, cx + w + 2 + sway, bot, 6, 1.5, t * 2);
      ctx.lineTo(cx + w - 2, top); ctx.closePath();
      ctx.fillStyle = '#ece6d8'; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(217,164,65,0.8)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx - w - 1 + sway, bot - 4); ctx.lineTo(cx + w + 1 + sway, bot - 4); ctx.stroke();
    } else if (O === 'pilot') {                        // extra thruster pod behind the pack
      const jx = cx - 8 - 13 * u, top = shY + 2, bot = hipY - 4;
      ctx.fillStyle = PAL.mid; rr(ctx, jx - 21, top + 2, 8, bot - top - 2, 4); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = PAL.amber; rr(ctx, jx - 20, top + 3, 6, 4, 2); ctx.fill();
      ctx.fillStyle = PAL.deep; rr(ctx, jx - 20.5, bot - 2, 7, 4, 1.5); ctx.fill();
      if (A.thrust > 0.02) { ctx.fillStyle = `rgba(255,190,90,${0.8 * A.thrust})`; ctx.beginPath(); ctx.ellipse(jx - 17, bot + 3, 3, 1.4, 0, 0, TAU); ctx.fill(); }
    }
  }

  // Hook: after the torso, before the near arm — belts, sashes, chest details.
  function outfitTorso(ctx, A, cx, hipY, shY, u, C) {
    { const X = XO[A.outfit]; if (X) { if (X.torso) X.torso(ctx, A, cx, hipY, shY, u, C); return; } }
    const O = A.outfit, t = A.t, tw = 20.5 * (1 - 0.12 * u), bw = 15 * (1 - 0.1 * u), yb = hipY + 2;
    if (O === 'ronin') {                               // red sash with a knot and two tails
      ctx.fillStyle = RED; rr(ctx, cx - bw - 0.5, yb - 10, bw * 2 + 1, 6, 2); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
      const kx = cx + bw - 3, ky = yb - 7;
      ctx.fillStyle = '#a7301f'; circle(ctx, kx, ky, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = RED; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      for (const [dx, ph] of [[2, 0], [-1.5, 1.3]]) { const s2 = Math.sin(t * 3 + ph) * 2.5; ctx.beginPath(); ctx.moveTo(kx, ky + 2); ctx.quadraticCurveTo(kx + dx + 3, ky + 8, kx + dx + s2, ky + 15); ctx.stroke(); }
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1;
      for (const [dx, ph] of [[2, 0], [-1.5, 1.3]]) { const s2 = Math.sin(t * 3 + ph) * 2.5; ctx.beginPath(); ctx.moveTo(kx, ky + 2); ctx.quadraticCurveTo(kx + dx + 3, ky + 8, kx + dx + s2, ky + 15); ctx.stroke(); }
    } else if (O === 'street') {                       // headphones round the neck + a player on the belt
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx - 19, shY + 1); ctx.quadraticCurveTo(cx + 1.5 * u, shY + 13, cx + 19, shY + 1); ctx.stroke();
      ctx.strokeStyle = '#3a2f5c'; ctx.lineWidth = 2.8; ctx.stroke();
      for (const sx of [cx - 19, cx + 19]) { ctx.fillStyle = '#1b1626'; circle(ctx, sx, shY + 3, 5); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke(); ctx.strokeStyle = NEON; ctx.lineWidth = 1.2; circle(ctx, sx, shY + 3, 2.6); ctx.stroke(); }
      ctx.fillStyle = PAL.deep; rr(ctx, cx + bw - 10, yb - 9, 8, 6, 1.5); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.save(); ctx.shadowColor = NEON; ctx.shadowBlur = 6; ctx.fillStyle = NEON; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5); circle(ctx, cx + bw - 6, yb - 6, 1.3); ctx.fill(); ctx.restore();
    } else if (O === 'pilot') {                        // orange flight stripe + pocket panels
      ctx.save(); torsoPath(ctx, cx, shY, yb, tw, bw); ctx.clip();
      ctx.strokeStyle = PAL.amber; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(cx - tw + 1, shY + 4); ctx.lineTo(cx - 2 + 3 * u, shY + 24); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - tw + 4, shY + 4); ctx.lineTo(cx + 1 + 3 * u, shY + 24); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, cx + 3 + 3 * u, yb - 15, 7, 6, 1.5); ctx.fill(); rr(ctx, cx - 10 + 3 * u, yb - 15, 7, 6, 1.5); ctx.fill();
      ctx.restore();
    } else if (O === 'spirit') {                       // paper charms on the belt
      for (const [bx, ph] of [[cx - bw + 1, 0], [cx + bw - 6, 1.1]]) {
        ctx.save(); ctx.translate(bx + 2, yb - 4); ctx.rotate(Math.sin(t * 2.4 + ph) * 0.12);
        ctx.fillStyle = '#fbf7ee'; rr(ctx, -2.2, 0, 4.4, 11, 0.8); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = '#c8402f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 2.2); ctx.lineTo(0, 8.5); ctx.moveTo(-1.2, 4); ctx.lineTo(1.2, 4); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Hook: after the near arm — sleeve details.
  function outfitArm(ctx, A, hand) {
    { const X = XO[A.outfit]; if (X) { if (X.arm && hand) X.arm(ctx, A, hand); return; } }
    const O = A.outfit; if (!hand) return;
    const { S, E, H } = hand;
    if (O === 'shinobi') {                             // forearm wraps
      const dx = H.x - E.x, dy = H.y - E.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      ctx.strokeStyle = 'rgba(205,210,222,0.6)'; ctx.lineWidth = 1.6;
      for (const k of [0.3, 0.5, 0.7]) { const px = lerp(E.x, H.x, k), py = lerp(E.y, H.y, k); ctx.beginPath(); ctx.moveTo(px - nx * 4, py - ny * 4); ctx.lineTo(px + nx * 4, py + ny * 4); ctx.stroke(); }
    } else if (O === 'street') {                       // neon stripes down the sleeve
      const dx = E.x - S.x, dy = E.y - S.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      ctx.save(); ctx.shadowColor = NEON; ctx.shadowBlur = 6; ctx.strokeStyle = NEON; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
      for (const o of [-2.2, 2.2]) { ctx.beginPath(); ctx.moveTo(S.x + nx * o, S.y + ny * o + 4); ctx.lineTo(E.x + nx * o, E.y + ny * o); ctx.stroke(); }
      ctx.restore();
    }
  }

  // Hook inside head(), before the shell: the hood.
  function outfitHeadBack(ctx, A, hw, hh) {
    { const X = XO[A.outfit]; if (X) { if (X.headBack) X.headBack(ctx, A, hw, hh); return; } }
    if (A.outfit === 'street') {
      ctx.fillStyle = '#2a2242'; rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 16, 21); ctx.fill();
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-hw - 5, -hh - 2); ctx.lineTo(-hw - 17, -hh - 16); ctx.lineTo(-hw + 2, -hh - 8); ctx.closePath();   // hood point at the back
      ctx.fillStyle = '#2a2242'; ctx.fill(); ctx.stroke();
    }
  }

  // Hook inside head(), after the shell and visor: hats, masks, scarves, helmet glass.
  function outfitHead(ctx, A, hw, hh, vx, vy, vw, vh, u, C) {
    { const X = XO[A.outfit]; if (X) { if (X.head) X.head(ctx, A, hw, hh, vx, vy, vw, vh, u, C); return; } }
    const O = A.outfit, t = A.t, asleep = A.eyes.mode === 'sleep';
    if (O === 'ronin') {                               // straw hat, tipped over the visor when he sleeps
      ctx.save();
      if (asleep) { ctx.translate(2, 11); ctx.rotate(0.32); }
      const bx = 40, by = -hh + 5, ax = -5 * u, ay = -hh - 15;
      ctx.beginPath(); ctx.moveTo(-bx, by); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.closePath();
      const g = ctx.createLinearGradient(0, ay, 0, by); g.addColorStop(0, STRAW); g.addColorStop(1, STRAW_D);
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
      for (const k of [-0.6, -0.3, 0.3, 0.6]) { ctx.beginPath(); ctx.moveTo(ax, ay + 2); ctx.lineTo(bx * k, by); ctx.stroke(); }
      ctx.fillStyle = 'rgba(10,14,21,0.55)'; ctx.beginPath(); ctx.moveTo(-bx, by); ctx.lineTo(bx, by); ctx.lineTo(bx - 6, by + 3.5); ctx.lineTo(-bx + 6, by + 3.5); ctx.closePath(); ctx.fill();   // brim shadow
      ctx.restore();
    } else if (O === 'shinobi') {                      // face scarf with tails streaming behind
      ctx.strokeStyle = '#2a2f3c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (const [ph, dy] of [[0, -2], [1.4, 4]]) { const w1 = Math.sin(t * 4 + ph) * 4, w2 = Math.sin(t * 4 + ph + 1.5) * 5; ctx.beginPath(); ctx.moveTo(-hw + 3, vy + 2); ctx.quadraticCurveTo(-hw - 14, vy + dy + w1, -hw - 28, vy + dy - 6 + w2); ctx.stroke(); }
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.2;
      for (const [ph, dy] of [[0, -2], [1.4, 4]]) { const w1 = Math.sin(t * 4 + ph) * 4, w2 = Math.sin(t * 4 + ph + 1.5) * 5; ctx.beginPath(); ctx.moveTo(-hw + 3, vy + 2); ctx.quadraticCurveTo(-hw - 14, vy + dy + w1, -hw - 28, vy + dy - 6 + w2); ctx.stroke(); }
      ctx.save(); rr(ctx, -hw, -hh, hw * 2, hh * 2, 15); ctx.clip();
      ctx.beginPath(); ctx.moveTo(-hw - 2, vy + 3); ctx.quadraticCurveTo(vx - 8, vy + 7, vx + 2, vy + 3.5); ctx.quadraticCurveTo(vx + 14, vy + 1, hw + 2, vy + 4); ctx.lineTo(hw + 2, hh + 2); ctx.lineTo(-hw - 2, hh + 2); ctx.closePath();
      ctx.fillStyle = '#1a1e27'; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; for (const y of [vy + 9, vy + 14]) { ctx.beginPath(); ctx.moveTo(-hw + 4, y); ctx.lineTo(hw - 4, y + 1); ctx.stroke(); }
      ctx.restore();
    } else if (O === 'pilot') {                        // helmet: ear pods, chin guard, tinted glass that lifts when he talks
      for (const x of [-hw - 5, hw - 2]) { ctx.fillStyle = PAL.amber; rr(ctx, x, -7, 7, 15, 3); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke(); ctx.fillStyle = PAL.deep; rr(ctx, x + 2, -3, 3, 7, 1); ctx.fill(); }
      ctx.fillStyle = PAL.armor; rr(ctx, -hw + 5, hh - 6, hw * 2 - 10, 8, 3.5); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = PAL.amber; rr(ctx, -4 + 7 * u, hh - 4, 8, 3, 1.5); ctx.fill();
      const lift = clamp(A.eyes.talk * 3, 0, 1) * 10;
      ctx.save(); ctx.translate(0, -lift);
      rr(ctx, vx - vw - 3, vy - vh - 3, vw * 2 + 6, vh * 2 + 6, 10);
      ctx.fillStyle = `rgba(255,150,40,${0.22 - 0.1 * (lift / 10)})`; ctx.fill(); ctx.strokeStyle = 'rgba(255,196,110,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.moveTo(vx - vw + 1, vy - vh - 2); ctx.lineTo(vx - vw + 11, vy - vh - 2); ctx.lineTo(vx - vw + 4, vy + vh + 2); ctx.lineTo(vx - vw - 2, vy + vh + 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (O === 'street') {                       // hood rim over the top of the head
      ctx.save(); rr(ctx, -hw - 7, -hh - 9, hw * 2 + 14, hh * 2 + 16, 21); ctx.clip();
      ctx.beginPath(); ctx.moveTo(-hw - 8, 2); ctx.lineTo(-hw - 8, -hh - 10); ctx.lineTo(hw + 8, -hh - 10); ctx.lineTo(hw + 8, 2);
      ctx.lineTo(hw - 2, 2); ctx.quadraticCurveTo(hw - 2, -hh + 4, 0, -hh + 4); ctx.quadraticCurveTo(-hw + 2, -hh + 4, -hw + 2, 2); ctx.closePath();
      ctx.fillStyle = '#3a2f5c'; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.shadowColor = NEON; ctx.shadowBlur = 5; ctx.strokeStyle = NEON; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(-hw + 2, 0); ctx.quadraticCurveTo(-hw + 2, -hh + 6, 0, -hh + 6); ctx.quadraticCurveTo(hw - 2, -hh + 6, hw - 2, 0); ctx.stroke(); ctx.restore();
      ctx.restore();
    } else if (O === 'spirit') {                       // fox mask pushed up on the side of the head
      ctx.save(); ctx.translate(hw - 11, -hh - 1); ctx.rotate(0.5);
      ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-7, -11); ctx.lineTo(-2, -5); ctx.lineTo(2, -5); ctx.lineTo(7, -11); ctx.lineTo(9, -3); ctx.quadraticCurveTo(8, 8, 0, 10); ctx.quadraticCurveTo(-8, 8, -9, -3); ctx.closePath();
      ctx.fillStyle = '#fbf7ee'; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = '#c8402f'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-7, 1); ctx.lineTo(-3, 3); ctx.moveTo(7, 1); ctx.lineTo(3, 3); ctx.moveTo(-5, -8); ctx.lineTo(-4, -5); ctx.moveTo(5, -8); ctx.lineTo(4, -5); ctx.stroke();
      ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.ellipse(-4, -1, 2.2, 1.1, -0.3, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(4, -1, 2.2, 1.1, 0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  // Spirit guardian: a wisp of flame orbits where the antenna light would be.
  function wisp(ctx, A, bx, by, C) {
    const sp = A.eyes.mode === 'sleep' ? 0.6 : 1.8, a = A.t * sp;
    const x = bx + Math.cos(a) * 17, y = by - 12 + Math.sin(a) * 5 + Math.sin(A.t * 3.1) * 1.5;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = GOLD; ctx.shadowBlur = 14;
    const g = ctx.createLinearGradient(0, y - 8, 0, y + 4); g.addColorStop(0, 'rgba(255,240,200,0)'); g.addColorStop(0.5, 'rgba(255,214,120,0.9)'); g.addColorStop(1, C(0.95));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y - 9 - Math.sin(A.t * 9) * 1.5); ctx.quadraticCurveTo(x + 4.5, y - 2, x, y + 4); ctx.quadraticCurveTo(x - 4.5, y - 2, x, y - 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; circle(ctx, x, y + 0.5, 1.4); ctx.fill();
    ctx.restore();
  }

  // Raining outside: an umbrella over his head, in his outfit's accent colour, and rain falling either side of it.
  function umbrella(ctx, A, hx, hy) {
    const t = A.t, cx = hx + 8, cy = hy - 64 + Math.sin(t * 2) * 1.2, R = 47;
    ctx.save();
    ctx.strokeStyle = 'rgba(154,208,255,0.55)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const x = -118 + i * 21.5 + (i % 2) * 6; if (Math.abs(x - cx) < R + 4) continue;
      const y = -184 + ((t * 250 + i * 53) % 184);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2.5, y + 11); ctx.stroke();
    }
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(cx + 26, cy); ctx.lineTo(cx + 26, hy + 30); ctx.quadraticCurveTo(cx + 26, hy + 38, cx + 19, hy + 36); ctx.stroke();
    ctx.strokeStyle = '#c9ced8'; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.quadraticCurveTo(cx - R + 4, cy - 30, cx, cy - 32); ctx.quadraticCurveTo(cx + R - 4, cy - 30, cx + R, cy);
    for (let i = 3; i >= 0; i--) { const x0 = cx - R + (i + 1) * (R / 2), x1 = cx - R + i * (R / 2); ctx.quadraticCurveTo((x0 + x1) / 2, cy - 7, x1, cy); }
    ctx.closePath(); ctx.fillStyle = PAL.amber; ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.2;
    for (const k of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(cx, cy - 32); ctx.quadraticCurveTo(cx + k * R * 0.7, cy - 22, cx + k * R, cy - 3); ctx.stroke(); }
    ctx.fillStyle = PAL.ink; circle(ctx, cx, cy - 33, 2.2); ctx.fill();
    ctx.restore();
  }

  // A little envelope he holds up when mail arrives.
  function envelope(ctx, x, y, C) {
    ctx.save(); ctx.translate(x + 2, y - 9); ctx.rotate(-0.18);
    ctx.fillStyle = '#f4f1e6'; rr(ctx, -9, -6, 18, 12, 2); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8.5, -5.5); ctx.lineTo(0, 1.5); ctx.lineTo(8.5, -5.5); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = C(0.95); circle(ctx, 6.5, -5.5, 2.6); ctx.fill(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  function paintEmote(ctx, em, px, py) {
    const t = em.t;
    const k = t < 0.14 ? smooth(t / 0.14) * 1.25 : 1.25 - 0.25 * smooth(clamp((t - 0.14) / 0.16, 0, 1));
    ctx.save();
    ctx.translate(px, py - t * 7); ctx.scale(k, k);
    ctx.globalAlpha = clamp((em.dur - t) / 0.3, 0, 1);
    ctx.font = `800 ${Math.round(19 * (em.size || 1))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = PAL.ink; ctx.lineJoin = 'round'; ctx.strokeText(em.ch, 0, 0);
    ctx.shadowColor = em.color; ctx.shadowBlur = 10; ctx.fillStyle = em.color; ctx.fillText(em.ch, 0, 0);
    ctx.restore();
  }

  /* ───────────────────────── css ───────────────────────── */
  let cssDone = false;
  function injectCss() {
    if (cssDone || typeof document === 'undefined') return;
    cssDone = true;
    const s = document.createElement('style');
    s.id = 'grit-css';
    s.textContent = `
.grit-layer{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2147483000;--grit-c:56,242,255;transition:opacity .35s ease;contain:strict}
.grit-layer.grit-hidden{opacity:0}
.grit-fx,.grit-bot{position:absolute;left:0;top:0}
.grit-bot{will-change:transform;filter:drop-shadow(0 0 7px rgba(var(--grit-c),.38)) drop-shadow(0 3px 3px rgba(0,0,0,.35))}
.grit-bubble{position:absolute;left:0;top:0;max-width:260px;min-width:60px;padding:8px 12px 10px;border-radius:12px;background:rgba(8,12,19,.94);border:1px solid rgba(var(--grit-c),.55);box-shadow:0 0 0 3px rgba(var(--grit-c),.07),0 0 22px rgba(var(--grit-c),.22),0 10px 28px rgba(0,0,0,.45);color:#e9f6ff;font:500 13px/1.42 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .2s ease;will-change:transform,opacity;white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box}
.grit-bubble.grit-show{opacity:1}
.grit-name{font:700 9.5px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;color:rgb(var(--grit-c));margin-bottom:5px;display:flex;align-items:center;gap:6px}
.grit-name::before{content:"";width:6px;height:6px;border-radius:50%;background:rgb(var(--grit-c));box-shadow:0 0 8px rgb(var(--grit-c))}
.grit-rest{visibility:hidden}
.grit-tail{position:absolute;width:10px;height:10px;background:rgba(8,12,19,.94);border:1px solid rgba(var(--grit-c),.55);border-top:0;border-left:0;transform:rotate(45deg);bottom:-6px;left:20px}
.grit-bubble.grit-below .grit-tail{bottom:auto;top:-6px;transform:rotate(225deg)}`;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ───────────────────────── engine ───────────────────────── */
  const DEFAULTS = {
    root: null, name: 'GRIT', scale: 0.9, wander: true, quips: true, interactive: true,
    floorInset: 0, sleepAfter: 180, trackIdle: true, autoResize: true, gravity: 2600,
    cursorEl: null, quipLines: null,
    sleepCorner: 'right',   // which bottom corner he goes to bed in: 'left' | 'right' | 'here' (sleep where he stands)
    outfit: 'none',         // none | ronin | shinobi | pilot | street | spirit | kaiju | oni | drifter | pirate | vampire | reaper | shark | pharaoh | knight
  };
  const STATE_TASKS = { listen: 1, think: 1, talk: 1, guard: 1 };

  class Grit {
    constructor(opts = {}) {
      this.o = Object.assign({}, DEFAULTS, opts);
      this.quipLines = Object.assign({}, QUIPS, opts.quipLines || {});
      this.root = this.o.root || document.body;
      this.scale = this.o.scale;
      this.G = this.o.gravity;
      this.dpr = Math.min(GLOBAL.devicePixelRatio || 1, 3);
      this._ev = {};
      this.time = 0;
      this.W = this.o.width || GLOBAL.innerWidth;
      this.H = this.o.height || GLOBAL.innerHeight;
      // physics
      this.x = this.W * 0.72; this.y = this.heightPx() + 20;
      this.vx = 0; this.vy = 0; this.vxT = 0;
      this.mode = 'air'; this.surface = null;
      this.rot = 0; this.rotVel = 0; this.rotSpring = new Spring(0, 70, 7);
      this.thrustAcc = null; this.thrust = 0; this.thrustT = 0;
      this.perches = [];
      // animation
      this.turn = 0.5; this.turnT = 0.5; this.facing = 1;
      this.squash = new Spring(0, 520, 17); this.squashT = 0;
      this.antenna = new Spring(0, 140, 6);
      this.hipDrop = 0; this.bob = 0; this.headTilt = 0; this.headDX = 0; this.headDY = 0;
      this.arms = { near: { a1: 0.1, a2: 0.3, sp: 0.12 }, far: { a1: 0.05, a2: 0.3, sp: 0.12 } };
      this.feet = { near: { x: 7, y: 0 }, far: { x: -7, y: 0 } };
      this.walkPhase = 0; this.moveAmt = 0;
      this.blinkT = 0; this.nextBlink = rand(1.5, 4);
      this.look = { x: 0, y: 0 };
      this.col = hexRgb(STATE_COLOR.idle); this.glow = 1;
      this.levels = [0, 0, 0, 0, 0]; this.levelIn = 0; this.levelAt = -99;
      this.talk = 0;
      this.timers = { dizzy: 0, surprised: 0, happy: 0, land: 0 };
      this.armed = false; this.swordFlash = 0; this.trail = [];   // sword: sheathed on the pack until asked
      this.outfit = OUTFITS[this.o.outfit] ? this.o.outfit : 'none'; usePalette(this.outfit); this._ghost = false;
      this._pendingOutfit = null;                                  // the outfit a transformation is changing into
      this.ambient = { rain: false, music: false, cold: false };   // the world outside: umbrella, headbanging, shivering
      this._ambNext = 0; this._clipY = null; this._clip = '';
      this._frontWid = null; this._frontAt = 0; this._lastFollow = -99; this._peekWid = null;
      this.emote = null;
      this.particles = []; this._fxDirty = false; this._spawnAcc = 0;
      // brain
      this.state = 'idle'; this._stateT = 0; this.task = null; this.queue = []; this.pose = 'stand';
      this.lastWave = -99; this.lastQuip = -99; this._greet = true;
      this.cursor = { x: -1e4, y: -1e4, at: -99 };
      this.userIdle = 0; this._lastInput = now(); this._extIdle = null;
      this.bubble = null; this.hidden = false; this.capturing = false; this.press = null; this.drag = null;
      this._buildDom();
      if (this.o.interactive) this._bindInput();
      this._last = now(); this._acc = 0;
      this._frame = this._frame.bind(this);
      this._raf = GLOBAL.requestAnimationFrame(this._frame);
    }

    /* ── public API ── */
    on(name, fn) { (this._ev[name] || (this._ev[name] = [])).push(fn); return () => this.off(name, fn); }
    off(name, fn) { const l = this._ev[name]; if (l) this._ev[name] = l.filter((f) => f !== fn); }
    _emit(name, ...a) { const l = this._ev[name]; if (l) for (const f of l.slice()) { try { f(...a); } catch (e) { console.error(e); } } }

    heightPx() { return STAND_H * this.scale; }
    walkSpeed() { return 64 * this.scale; }
    runSpeed() { return 190 * this.scale; }

    command(c) {
      if (!c || typeof c !== 'object') return;
      switch (c.type) {
        case 'say': this.say(c.text, { duration: c.duration, state: c.state }); break;
        case 'state': this.setState(c.state); break;
        case 'action': this.act(c.action, c); break;
        case 'level': this.setLevel(c.value); break;
        case 'config': this.configure(c); break;
      }
    }

    configure(c = {}) {
      if (c.scale && isFinite(c.scale) && c.scale !== this.scale) { this.scale = clamp(+c.scale, 0.4, 2); this._sizeCanvases(); }
      if (typeof c.wander === 'boolean') this.o.wander = c.wander;
      if (typeof c.quips === 'boolean') this.o.quips = c.quips;
      if (c.sleepAfter && isFinite(c.sleepAfter)) this.o.sleepAfter = +c.sleepAfter;
      if (typeof c.name === 'string' && c.name.trim()) { this.o.name = c.name.trim().slice(0, 24); this._nameEl.textContent = this.o.name; }
      if (typeof c.sleepCorner === 'string' && ['left', 'right', 'here'].includes(c.sleepCorner)) this.o.sleepCorner = c.sleepCorner;
      if (typeof c.outfit === 'string') this.setOutfit(c.outfit);
      if (c.ambient && typeof c.ambient === 'object') for (const k of ['rain', 'music', 'cold']) if (typeof c.ambient[k] === 'boolean') this.ambient[k] = c.ambient[k];
      if (typeof c.followWindows === 'boolean') this.o.followWindows = c.followWindows;
      if (typeof c.transform === 'boolean') this.o.transform = c.transform;
    }

    setState(s) {
      if (!STATE_COLOR[s]) return false;
      const prev = this.state;
      this._stateT = 0;
      if (s === prev) return true;
      this.state = s;
      this._applyColorVars();
      this._emit('state', s);
      if (this.mode === 'drag') return true;
      // A mood change recolours him but must not cut a performance short (the assistant flips
      // thinking → talking → idle around every reply, which used to end a fight after two seconds).
      const T = this.task;
      if (T && T.type === 'hop' && this.mode === 'air') return true;
      if (T && s !== 'sleep' && Grit.PERFORMANCES.has(T.type)) return true;
      this._interrupt();
      if (s === 'idle' && prev === 'sleep') this.queue.push({ type: 'stretch' });
      if (prev === 'sleep' && this.inBed()) this._leaveBed(true);   // woken in his corner → come out to you
      if (s === 'alert') this._emote('!', PAL.amber, 1.4);
      return true;
    }

    setLevel(v) { this.levelIn = clamp(+v || 0, 0, 1); this.levelAt = this.time; }

    say(text, o = {}) {
      text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (text.length > 400) text = text.slice(0, 399) + '…';
      if (o.state && STATE_COLOR[o.state]) this.setState(o.state);
      else if (this.state === 'sleep') this.setState('idle');
      const hold = o.duration != null && isFinite(o.duration) ? Math.max(0.8, +o.duration) : clamp(1.4 + text.length * 0.05, 2.4, 10);
      this.bubble = { text, n: -1, phase: 'type', hold, t: 0, revert: o.state === 'talking' || o.state === 'alert' ? o.state : null };
      this._typedEl.textContent = '';
      this._restEl.textContent = text;
      this.bubbleEl.classList.add('grit-show');
      this._bubbleSize = null;
      this._emit('say', text);
    }

    act(a, args = {}) {
      const s = this.scale;
      switch (a) {
        case 'jump': return this._enqueue({ type: 'hop', rel: true, dx: 0, arc: 75 * s });
        case 'flip': return this._enqueue({ type: 'hop', rel: true, dx: rand(-40, 40) * s, arc: 105 * s, flip: true });
        case 'wave': return this._enqueue({ type: 'wave', dur: 2 });
        case 'outfit': return this.setOutfit(args.name || args.outfit);
        case 'yawn': case 'mail': case 'wrist': case 'laugh': case 'cheer': case 'sad': case 'gasp': {   // small reactions to what's happening
          if (this.task && this.task.type === 'sleep') return;                                              // let him sleep
          const dur = { yawn: 2.4, mail: 2.6, wrist: 2.4, laugh: 1.8, cheer: 1.8, sad: 2.2, gasp: 1.3 }[a];
          return this._enqueue({ type: 'react', kind: a, dur });
        }
        case 'dance': return this._enqueue({ type: 'dance', dur: 3.2 });
        case 'signature': case 'sig': case 'trick': return this._signature();
        case 'peek': return this._enqueue({ type: 'peek' });
        case 'draw': return this.armed ? this._enqueue({ type: 'flourish', dur: 1.1 }) : this._enqueue({ type: 'draw', dur: 1.15 });
        case 'sheathe': return this.armed ? this._enqueue({ type: 'sheathe', dur: 1.0 }) : undefined;
        case 'fight': {
          if (!this.armed) this._enqueue({ type: 'draw', dur: 1.15 });
          return this._enqueue({ type: 'fight', dur: args.dur && isFinite(args.dur) ? clamp(+args.dur, 2, 20) : 6 });
        }
        case 'kata': {   // shadow fighting: a travelling sword form against imaginary opponents
          if (!this.armed) this._enqueue({ type: 'draw', dur: 1.15 });
          return this._enqueue({ type: 'kata', dur: args.dur && isFinite(args.dur) ? clamp(+args.dur, 4, 60) : 18 });
        }
        case 'fly': return this._enqueue(this._flyTask(args.x != null ? +args.x : rand(0.15, 0.85) * this.W, args.y != null ? +args.y : rand(0.2, 0.5) * this.H, 2));
        case 'summon': {
          const c = this.cursor, known = c.x > -1e3;
          return this._enqueue(this._flyTask(known ? c.x : this.W / 2, known ? c.y - 12 * s : this.H / 2, 1.4, true));
        }
        case 'goto': {
          if (args.x == null || !isFinite(args.x)) return;
          if (args.y != null && isFinite(args.y)) return this._enqueue(this._flyTask(+args.x, +args.y, 1.2));
          return this._enqueue({ type: 'goto', x: +args.x });
        }
        case 'sleep': return this.setState('sleep');
        case 'wake': if (this.state === 'sleep') this.setState('idle'); else if (this.task && this.task.type === 'sleep') this._wake(); return;
        case 'hide': return this.setHidden(true);
        case 'show': return this.setHidden(false);
        case 'wander': this.o.wander = true; return;
        case 'stop': this.o.wander = false; this._interrupt(); return;
      }
    }

    setHidden(h) {
      this.hidden = !!h;
      this.layer.classList.toggle('grit-hidden', this.hidden);
      this._updateCapture();
    }

    setCursor(x, y) {
      if (x === this.cursor.x && y === this.cursor.y) return;
      this.cursor.x = x; this.cursor.y = y; this.cursor.at = this.time;
    }

    setUserIdle(sec) { this._extIdle = Math.max(0, +sec || 0); this._extIdleAt = now(); }

    setFloorInset(px) {
      this.o.floorInset = Math.max(0, +px || 0);
      if (this.mode === 'ground' && this.surface.type === 'floor') { this.surface = this._floor(); this.y = this.surface.y; }
    }

    setWorld(W, H) {
      if (!(W > 0 && H > 0)) return;
      if (W === this.W && H === this.H) return;
      this.W = W; this.H = H; this._sizeCanvases();
      const f = this._floor();
      if (this.mode === 'ground' && this.surface.type === 'floor') { this.surface = f; this.y = f.y; }
      this.x = clamp(this.x, 20, W - 20);
      if (this.y > f.y) this.y = f.y;
    }

    setPerches(list) {
      const arr = Array.isArray(list) ? list.filter((p) => p && isFinite(p.x1) && isFinite(p.x2) && isFinite(p.y) && p.x2 > p.x1) : [];
      this.perches = arr;
      const fr = arr.find((p) => p.front), fw = fr ? fr.wid : null;
      if (fw !== this._frontWid) { this._frontWid = fw; this._frontAt = this.time; }
      const S = this.surface;
      if (this.mode !== 'ground' || !S || S.type !== 'perch') return;
      const mine = arr.filter((p) => p.wid === S.wid);
      if (!mine.length) {   // the window he stood on was closed: a startled hop, then he tumbles down
        this._toAir(); this.timers.surprised = 0.9; this.vy = -170 * Math.sqrt(this.scale);
        this.rotVel = rand(5, 8) * (Math.random() < 0.5 ? -1 : 1); this._tumbled = true; this._emote('!', PAL.amber, 0.9);
        return;
      }
      const ref = mine[0];
      const dx = ref.ox != null && S.ox != null ? ref.ox - S.ox : 0;
      const nx = this.x + dx;
      const seg = mine.find((p) => nx >= p.x1 - 2 && nx <= p.x2 + 2);
      this.x = nx;
      if (!seg) { this._toAir(); return; }
      this.y = seg.y;
      this.surface = Object.assign({ type: 'perch' }, seg);
    }

    status() {
      const S = this.surface;
      return {
        name: this.o.name, state: this.state, task: this.task ? this.task.type : null, mode: this.mode, scale: this.scale,
        x: Math.round(this.x), y: Math.round(this.y),
        surface: S ? (S.type === 'perch' ? { type: 'window', id: S.wid } : { type: 'floor' }) : null,
        speaking: !!this.bubble, hidden: this.hidden, sword: this.armed ? 'drawn' : 'sheathed',
        inBed: this.inBed(), sleepCorner: this.o.sleepCorner, outfit: this._pendingOutfit || this.outfit, outfits: OUTFIT_NAMES, ambient: Object.assign({}, this.ambient),
      };
    }

    /** World position just above GRIT's head (where bubbles hang). */
    anchor() { const hd = this._head || { hx: 0, hy: -85 }; return this._l2w(hd.hx, hd.hy - 30); }

    destroy() {
      GLOBAL.cancelAnimationFrame(this._raf);
      if (this._h) {
        const opt = { capture: true };
        GLOBAL.removeEventListener('pointerdown', this._h.down, opt);
        GLOBAL.removeEventListener('pointermove', this._h.move, opt);
        GLOBAL.removeEventListener('pointerup', this._h.up, opt);
        GLOBAL.removeEventListener('pointercancel', this._h.up, opt);
        GLOBAL.removeEventListener('contextmenu', this._h.ctx, opt);
        GLOBAL.removeEventListener('keydown', this._h.act, true);
        GLOBAL.removeEventListener('resize', this._h.resize);
      }
      this.layer.remove();
    }

    /* ── dom ── */
    _buildDom() {
      injectCss();
      const L = (this.layer = document.createElement('div'));
      L.className = 'grit-layer';
      this.fx = document.createElement('canvas'); this.fx.className = 'grit-fx';
      this.cv = document.createElement('canvas'); this.cv.className = 'grit-bot';
      const b = (this.bubbleEl = document.createElement('div'));
      b.className = 'grit-bubble';
      b.innerHTML = '<div class="grit-name"></div><div class="grit-text"><span class="grit-typed"></span><span class="grit-rest"></span></div><i class="grit-tail"></i>';
      this._nameEl = b.querySelector('.grit-name'); this._nameEl.textContent = this.o.name;
      this._typedEl = b.querySelector('.grit-typed'); this._restEl = b.querySelector('.grit-rest'); this._tailEl = b.querySelector('.grit-tail');
      L.append(this.cv, this.fx, b);
      this.root.appendChild(L);
      this.ctx = this.cv.getContext('2d'); this.fctx = this.fx.getContext('2d');
      this._sizeCanvases();
      this._applyColorVars();
    }
    _sizeCanvases() {
      const css = BOX * this.scale, d = this.dpr;
      this.cv.style.width = this.cv.style.height = css + 'px';
      this.cv.width = this.cv.height = Math.ceil(css * d);
      this.fx.style.width = this.W + 'px'; this.fx.style.height = this.H + 'px';
      this.fx.width = Math.ceil(this.W * d); this.fx.height = Math.ceil(this.H * d);
      this._fxDirty = true;
    }
    /* ── bed: a bottom corner of the screen ── */
    _bedX() {
      const s = this.scale, c = this.o.sleepCorner;
      return c === 'left' ? 58 * s : c === 'right' ? this.W - 58 * s : this.x;
    }
    inBed() {
      if (this.mode !== 'ground' || !this.surface || this.surface.type !== 'floor' || this.o.sleepCorner === 'here') return false;
      return Math.abs(this.x - this._bedX()) < 30 * this.scale;
    }
    _applyColorVars() { this.layer.style.setProperty('--grit-c', hexRgb(STATE_COLOR[this.state]).join(',')); }

    /* ── input ── */
    _bindInput() {
      const opt = { capture: true, passive: false };
      this._h = {
        down: (e) => this._onDown(e), move: (e) => this._onMove(e), up: (e) => this._onUp(e), ctx: (e) => this._onCtx(e),
        act: () => { this._lastInput = now(); },
        resize: () => { if (this.o.autoResize) this.setWorld(GLOBAL.innerWidth, GLOBAL.innerHeight); },
      };
      GLOBAL.addEventListener('pointerdown', this._h.down, opt);
      GLOBAL.addEventListener('pointermove', this._h.move, opt);
      GLOBAL.addEventListener('pointerup', this._h.up, opt);
      GLOBAL.addEventListener('pointercancel', this._h.up, opt);
      GLOBAL.addEventListener('contextmenu', this._h.ctx, opt);
      GLOBAL.addEventListener('keydown', this._h.act, true);
      GLOBAL.addEventListener('resize', this._h.resize);
    }
    _hit(px, py) {
      if (this.hidden) return false;
      const s = this.scale, c = this._l2w(0, -60);
      const dx = (px - c.x) / (32 * s), dy = (py - c.y) / (63 * s);
      return dx * dx + dy * dy <= 1;
    }
    _onDown(e) {
      this._lastInput = now();
      if (e.button !== 0) return;
      if (!this._hit(e.clientX, e.clientY)) return;
      e.preventDefault(); e.stopPropagation();
      this.press = { x: e.clientX, y: e.clientY, t: now(), dragging: false };
      try { document.documentElement.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this._updateCapture();
    }
    _onMove(e) {
      this._lastInput = now();
      this.setCursor(e.clientX, e.clientY);
      if (!this.press) return;
      if (!this.press.dragging && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 5) this._beginDrag(this.press.x, this.press.y);
      if (this.press.dragging && this.drag) {
        this.drag.px = e.clientX; this.drag.py = e.clientY;
        const tn = now(), H = this.drag.hist;
        H.push({ x: e.clientX, y: e.clientY, t: tn });
        while (H.length > 2 && tn - H[0].t > 200) H.shift();
      }
    }
    _onUp(e) {
      if (!this.press) return;
      const p = this.press; this.press = null;
      if (p.dragging) this._endDrag(); else this._onClick({ x: e.clientX, y: e.clientY });
      this._updateCapture();
    }
    _onCtx(e) {
      if (!this._hit(e.clientX, e.clientY)) return;
      e.preventDefault(); e.stopPropagation();
      this._emit('contextmenu', { x: e.clientX, y: e.clientY });
    }
    _onClick(p) {
      const tn = now();
      if (this._clickTimer && tn - this._lastClick < 330) {
        clearTimeout(this._clickTimer); this._clickTimer = null;
        this._emit('click', { double: true });
        if (this.mode === 'ground' && !(this.task && this.task.type === 'sleep')) { this._interrupt(); this._start({ type: 'hop', rel: true, dx: 0, arc: 105 * this.scale, flip: true }); }
        return;
      }
      this._lastClick = tn;
      this._clickTimer = setTimeout(() => { this._clickTimer = null; this._emit('click', { double: false }); this._singleClick(p); }, 260);
    }
    _singleClick(p) {
      const T = this.task;
      if (T && T.type === 'sleep') { if (this.state === 'sleep') this.setState('idle'); else this._wake(); this._quip('wake', 0); return; }
      if (this.mode !== 'ground') return;
      if (T && STATE_TASKS[T.type]) { this._emote('?', CYAN, 1.1); return; }
      const r = Math.random();
      if (r < 0.3) { this._interrupt(); this.timers.happy = 1.2; this._emote('♪', CYAN, 1); this._start({ type: 'hop', rel: true, dx: 0, arc: 36 * this.scale }); }
      else if (r < 0.52) { this._emote('?', CYAN, 1.1); this.turnT = Math.sign(p.x - this.x || 1) * 0.3; }
      else if (r < 0.74) { this._interrupt(); this.lastWave = this.time; this._start({ type: 'wave', dur: 1.6 }); }
      else if (!this._quip('click', 0)) this._emote('!', PAL.amber, 1);
    }
    _beginDrag(px, py) {
      this._interrupt();
      this.mode = 'drag'; this.surface = null;
      this.task = { type: 'held', t: 0 };
      this.drag = { px, py, ox: px - this.x, oy: py - this.y, hist: [{ x: px, y: py, t: now() }] };
      this.press.dragging = true;
      this.timers.surprised = 0.7; this._shake = 0;
      this.rotSpring.value = this.rot; this.rotSpring.vel = 0;
      this._emit('grab');
    }
    _endDrag() {
      const H = this.drag.hist, tn = now();
      let i = H.length - 1;
      while (i > 0 && tn - H[i - 1].t < 110) i--;
      const a = H[i], b = H[H.length - 1], dtt = Math.max(16, b.t - a.t) / 1000;
      let vx = (b.x - a.x) / dtt, vy = (b.y - a.y) / dtt;
      if (tn - b.t > 120) { vx = 0; vy = 0; }
      const sp = Math.hypot(vx, vy), cap = 3000;
      if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
      this.drag = null; this.task = null;
      this._toAir(); this.vx = vx; this.vy = vy;
      this.rotVel = sp > 700 ? clamp(vx * 0.005, -16, 16) : 0;
      this._thrown = { spin: Math.abs(this.rotVel), speed: sp };
      this._emit('throw', { vx, vy });
    }
    _updateCapture() {
      const want = !this.hidden && (!!this.press || this.mode === 'drag' || this._hit(this.cursor.x, this.cursor.y));
      if (want !== this.capturing) { this.capturing = want; this._emit('capture', want); }
      const cur = this.mode === 'drag' ? 'grabbing' : want ? 'grab' : '';
      if (cur !== this._cursorStyle) { this._cursorStyle = cur; (this.o.cursorEl || document.documentElement).style.cursor = cur; }
    }

    /* ── loop ── */
    _frame() {
      this._raf = GLOBAL.requestAnimationFrame(this._frame);
      const tn = now();
      let dt = (tn - this._last) / 1000; this._last = tn;
      if (dt <= 0) return;
      if (dt > 0.1) dt = 0.1;
      this.userIdle = this._extIdle != null ? this._extIdle + (tn - this._extIdleAt) / 1000 : this.o.trackIdle ? (tn - this._lastInput) / 1000 : 0;
      const STEP = 1 / 120;
      this._acc = Math.min(this._acc + dt, 0.1);
      while (this._acc >= STEP) { this._step(STEP); this._acc -= STEP; }
      this._animate(dt);
      this._updateFx(dt);
      this._updateBubble(dt);
      this._updateCapture();
      if (this.pose === 'sleep' && !this.particles.length && !this.bubble && (this._skip = !this._skip)) return;  // half-rate while asleep
      this._render();
    }

    _step(dt) {
      this.time += dt;
      this.vxT = 0; this.pose = 'stand'; this.thrustT = 0; this._clipY = null;
      if (this.mode === 'peek' && !(this.task && this.task.type === 'peek')) this._endPeek();
      if (this._pendingOutfit && !(this.task && this.task.type === 'transform')) { const o = this._pendingOutfit; this._pendingOutfit = null; this._swapOutfit(o); }
      if (!this.task) this._chooseNext();
      if (this.task) this._runTask(dt);
      this._physics(dt);
      this._timers(dt);
      this.squash.target = this._squashPose || 0;
      this.squash.step(dt);
      this.antenna.target = this._antT || 0;
      this.antenna.step(dt);
    }

    _timers(dt) {
      for (const k in this.timers) if (this.timers[k] > 0) this.timers[k] = Math.max(0, this.timers[k] - dt);
      if (this.emote) { this.emote.t += dt; if (this.emote.t > this.emote.dur) this.emote = null; }
      this._stateT += dt;
      if (this.state === 'alert' && this._stateT > 4.5 && !this.bubble) this.setState('idle');
      const am = this.ambient;
      if ((am.music || am.cold) && this.time > this._ambNext && this.state === 'idle' && this.mode === 'ground' && !this.emote && !(this.task && Grit.PERFORMANCES.has(this.task.type)) && this.pose !== 'sleep') {
        this._ambNext = this.time + (am.cold ? rand(5, 8) : rand(2.4, 3.8));
        if (am.cold) this._emote('brr', '#9ad0ff', 1.1, 0.8); else this._emote('♪', CYAN, 0.9, 1);
      }
    }

    /* ── brain ── */
    _start(T) {
      if (T.type === 'wave') T = this._greetTask(T);   // each outfit greets its own way
      T.t = 0;
      if (T.type === 'hop') {
        const S = this.surface || this._floor();
        if (T.rel) { const m = this._edgeMargin(S); T.x = clamp(this.x + (T.dx || 0), S.x1 + m, S.x2 - m); T.y = S.y; }
        if (T.arc == null) T.arc = this._arc(T.x, T.y);
        T.rocket = this.y - (Math.min(this.y, T.y) - T.arc) > 240 * this.scale;
        T.phase = 'crouch';
      } else if (T.type === 'goto') {
        const S = this.surface || this._floor();
        const tx = clamp(T.x, 20, this.W - 20);
        if (S.type === 'floor') { T.type = 'walk'; T.x = tx; T.run = Math.abs(tx - this.x) > 200 * this.scale; }
        else return this._start({ type: 'hop', x: tx, y: this._floor().y });
      }
      this.task = T;
    }
    _done() { this.task = null; }
    // Bedtime: fly to his corner of the screen, land, then sleep facing the room. 'here' → sleep on the spot.
    _goToBed(auto, startNow) {
      const sleep = { type: 'sleep', auto, bed: this.o.sleepCorner !== 'here' };
      this.queue = this.queue.filter((t) => t.type !== 'sleep');
      this.armed = false;
      if (!sleep.bed || this.inBed()) return startNow ? this._start(sleep) : this._enqueue(sleep);
      const fly = Object.assign(this._flyTask(this._bedX(), this._floor().y - 26 * this.scale, 0.25), { bed: true });
      this.queue.push(sleep);
      this._interrupt(); this._start(fly);
    }
    _leaveBed(append) {   // awake: hop back out of the corner
      const s = this.scale, f = this._floor();
      const dir = this.x > this.W / 2 ? -1 : 1;
      const hop = { type: 'hop', x: clamp(this.x + dir * rand(90, 160) * s, 40 * s, this.W - 40 * s), y: f.y };
      if (append) this.queue.push(hop); else this.queue.unshift(hop);
    }
    _interrupt() { this.thrustAcc = null; this.task = null; }
    _enqueue(T) {
      this.queue.push(T);
      if (this.queue.length > 6) this.queue.shift();
      if (this.mode === 'drag') return;
      if (this.task && this.task.type === 'hop' && this.mode === 'air') return;
      this._interrupt();
    }
    _edgeMargin(S) { return S.type === 'floor' ? 26 * this.scale : Math.min(14 * this.scale, (S.x2 - S.x1) * 0.3); }
    _arc(x, y) { return clamp(Math.abs(x - this.x) * 0.22 + 46 * this.scale, 40 * this.scale, 190 * this.scale); }
    _floor() { return { type: 'floor', x1: 0, x2: this.W, y: this.H - this.o.floorInset }; }
    _allPerches() { return this.perches; }
    _surfaces() {
      const list = [this._floor()], minY = this.heightPx() + 24;
      for (const p of this.perches) if (p.x2 - p.x1 >= 60 && p.y >= minY && p.y < this.H - this.o.floorInset - 30) list.push(Object.assign({ type: 'perch' }, p));
      return list;
    }
    _cursorDist() { const c = this.cursor; return this.time - c.at > 4 ? 1e9 : Math.hypot(c.x - this.x, c.y - (this.y - 60 * this.scale)); }
    _flyTask(x, y, dur, summon) {
      const s = this.scale;
      return { type: 'fly', phase: 'start', x: clamp(x, 40 * s, this.W - 40 * s), y: clamp(y, this.heightPx() + 20, this.H - this.o.floorInset - 50 * s), dur, summon };
    }
    _quip(kind, cooldown = 8) {
      if (!this.o.quips || this.time - this.lastQuip < cooldown) return false;
      const O = this._outfit(); const lines = (O.quips && O.quips[kind]) || this.quipLines[kind]; if (!lines || !lines.length) return false;
      this.lastQuip = this.time; this.say(pick(lines)); return true;
    }
    _emote(ch, color, dur = 1.2, size = 1) { this.emote = { ch, color, t: 0, dur, size }; }
    _outfit() { return OUTFITS[this.outfit] || OUTFITS.none; }
    _greetTask(T) {
      const g = this._outfit().greet, d = { bow: 1.9, salute: 1.8, fist: 1.5, vanish: 1.3 }[g];
      return d ? Object.assign({}, T, { type: g, dur: d }) : T;
    }
    setOutfit(name) {
      name = String(name || 'none').toLowerCase();
      if (!OUTFITS[name]) return false;
      if (name === (this._pendingOutfit || this.outfit)) return true;
      // On his feet and awake he changes with a little show: a spin in a burst of light, new outfit, then his greeting.
      const showy = !arguments[1] && this.o.transform !== false && this.time > 2 && !this.hidden && this.mode === 'ground' && !(this.task && this.task.type === 'sleep');
      if (!showy) { this._pendingOutfit = null; this._swapOutfit(name); return true; }
      this._pendingOutfit = name;
      this._interrupt(); this.queue = this.queue.filter((t) => t.type === 'sleep');
      this._start({ type: 'transform', to: name, dur: 1.9 });
      return true;
    }
    _swapOutfit(name) { if (!OUTFITS[name]) return; this.outfit = name; usePalette(name); this._emit('outfit', name); }

    /* ── signature moves: the one thing only this outfit does ── */
    _signature() {
      const s = this.scale, o = this.outfit;
      if (this.mode === 'peek' || (this.task && this.task.type === 'sleep')) return;
      switch (o) {
        case 'ronin': this._enqueue({ type: this.armed ? 'flourish' : 'draw', dur: 1.15 }); this.queue.push({ type: 'flourish', dur: 1.1 }, { type: 'sheathe', dur: 1.0 }); return;
        case 'shinobi': return this._enqueue({ type: 'vanish', dur: 1.5, tele: true });
        case 'pilot': return this._enqueue({ type: 'hop', rel: true, dx: 0, arc: 260 * s, flip: true });
        case 'street': return this._enqueue({ type: 'dance', dur: 3.4 });
        case 'none': this._enqueue({ type: 'hop', rel: true, dx: 0, arc: 105 * s, flip: true }); this.queue.push({ type: 'wave', dur: 1.6 }); return;
      }
      const dur = { kaiju: 2.2, oni: 2.0, drifter: 2.3, pirate: 2.6, vampire: 2.1, reaper: 1.9, shark: 2.6, pharaoh: 2.8, knight: 2.1, spirit: 2.3 }[o] || 2;
      return this._enqueue({ type: 'sig', kind: o, dur });
    }
    _doSig(T, dt) {
      const s = this.scale, k = T.kind, t = T.t, d = T.dur, ground = this.mode === 'ground';
      const at = (when, key, fn) => { if (t >= when && !T[key]) { T[key] = true; fn(); } };
      this.pose = 'sig';
      if (k !== 'shark' && k !== 'pharaoh') this._faceCursor(0.3, true);
      switch (k) {
        case 'kaiju':
          at(0.45, 'a', () => { this._emote('RAWR!', PAL.amber, 1.2, 1.35); this._slashSparks(14); this.squash.vel -= 3; });
          at(1.5, 'b', () => this._emote('rawr', PAL.amber, 0.6, 0.8));
          break;
        case 'oni':
          at(0.25, 'a', () => { if (ground) { this.vy = -480 * Math.sqrt(s); this._toAir(); T.up = true; } });
          if (T.up && ground && !T.slam) { T.slam = true; this._dust(this.x, this.y, 20, 280); this._slashSparks(12); this._emote('BOOM', PAL.amber, 1.0, 1.3); }
          if (t > d && !ground) return;        // finish only once he has landed
          break;
        case 'drifter':
          at(0.42, 'a', () => { this._emote('pew', PAL.amber, 0.4, 0.9); this._slashSparks(5); });
          at(0.78, 'b', () => { this._emote('pew', PAL.amber, 0.4, 0.9); this._slashSparks(5); });
          break;
        case 'pirate': at(0.3, 'a', () => this._emote('Arr!', PAL.amber, 1.0, 1.1)); break;
        case 'vampire':
          at(0.1, 'a', () => this._smoke(this.x, this.y, 8));
          at(1.25, 'b', () => { this._smoke(this.x, this.y, 12); this._emote('✦', '#ff3355', 0.8, 1.1); });
          break;
        case 'reaper': at(0.62, 'a', () => { this._slashSparks(12); this.swordFlash = 0.6; }); at(0.85, 'b', () => this._emote('☠', '#7df9c9', 0.9, 1.2)); break;
        case 'shark': {
          if (t < 1.0 && ground) {            // dart at the cursor…
            const S = this.surface, m = this._edgeMargin(S);
            if (T.tx == null) T.tx = clamp(clamp(this.cursor.x, this.x - 340 * s, this.x + 340 * s), S.x1 + m, S.x2 - m);
            const dx = T.tx - this.x;
            if (Math.abs(dx) > 4) { this.vxT = Math.sign(dx) * Math.min(this.runSpeed(), Math.abs(dx) * 6 + 20); this.turnT = Math.sign(dx) * 0.85; this.pose = 'walk'; }
          } else this._faceCursor(0.5, true);
          at(1.1, 'a', () => { this._emote('CHOMP!', PAL.amber, 0.5, 1.2); this.squash.vel += 5; });   // …and bite
          at(1.55, 'b', () => { this._emote('CHOMP!', PAL.amber, 0.5, 1.2); this.squash.vel += 5; });
          break;
        }
        case 'pharaoh':
          this.turnT = 0.8 * (Math.sin(t * 5.2) > 0 ? 1 : -1);
          at(0.3, 'a', () => this._emote('☀', '#ffd84a', 1.3, 1.3));
          if (!T.gl || t > T.gl) { T.gl = t + 0.12; this._spawn('glint', this.x + rand(-28, 28) * s, this.y - rand(20, 110) * s, rand(-20, 20) * s, -rand(20, 60) * s, rand(0.5, 0.9), rand(1.5, 3) * s); }
          break;
        case 'knight': at(0.5, 'a', () => { this._emote('⚔', '#e8c15c', 1.0, 1.3); this._slashSparks(10); this.squash.vel -= 3; }); break;
        case 'spirit':
          at(0.2, 'a', () => this._emote('✦', PAL.amber, 1.2, 1.3));
          if (!T.gl || t > T.gl) { T.gl = t + 0.05; const a = t * 7; this._spawn('glint', this.x + Math.cos(a) * 46 * s, this.y - (20 + t * 46) * s, 0, -30 * s, rand(0.6, 1.0), rand(2, 3.2) * s); }
          break;
      }
      if (t > d) { this._done(); this.timers.happy = 1; }
    }

    /* ── behind the window: he slips down behind its top edge, peeks over it, then climbs back up ── */
    _frontPerch() {
      let best = null;
      for (const p of this._surfaces()) if (p.type === 'perch' && p.front && (!best || p.x2 - p.x1 > best.x2 - best.x1)) best = p;
      return best;
    }
    _endPeek() {
      const P = this.perches.find((p) => p.wid === this._peekWid && this.x >= p.x1 - 2 && this.x <= p.x2 + 2);
      this._clipY = null; this._peekWid = null;
      if (P) { this.mode = 'ground'; this.surface = Object.assign({ type: 'perch' }, P); this.y = P.y; this.vy = 0; }
      else { this.mode = 'air'; this.surface = null; this.vy = 0; }
    }
    _doPeek(T, dt) {
      const s = this.scale;
      if (!T.wid) {
        const S = this.surface;
        if (this.mode !== 'ground' || !S || S.type !== 'perch' || S.x2 - S.x1 < 70 * s) return this._done();
        const m = this._edgeMargin(S);
        this.x = clamp(this.x, S.x1 + m, S.x2 - m);
        T.wid = this._peekWid = S.wid; T.t = 0; this.mode = 'peek'; this.vx = 0; this.vy = 0;
      }
      const P = this.perches.find((p) => p.wid === T.wid && this.x >= p.x1 - 2 && this.x <= p.x2 + 2);
      if (!P) { this._done(); return this._endPeek(); }          // the window moved away or closed: he pops out and drops
      const t = T.t, eyes = 68 * s, deep = 124 * s;
      let dpt;
      if (t < 0.5) dpt = smooth(t / 0.5) * deep;                 // sinks out of sight
      else if (t < 1.2) dpt = deep;
      else if (t < 1.6) dpt = lerp(deep, eyes, smooth((t - 1.2) / 0.4));   // just the eyes come up
      else if (t < 3.6) dpt = eyes - (t > 2.5 && t < 2.8 ? Math.sin((t - 2.5) / 0.3 * Math.PI) * 8 * s : 0);
      else dpt = lerp(eyes, 0, smooth(clamp((t - 3.6) / 0.5, 0, 1)));      // and he climbs back up
      this.y = P.y + dpt; this._clipY = P.y; this.pose = 'peek'; this.turnT = 0.1 * this.facing;
      if (t > 1.7 && !T.em) { T.em = true; this._emote('?', CYAN, 0.9, 1); }
      if (t > 4.1) { this._done(); this._endPeek(); this.timers.happy = 1; this.queue.push({ type: 'edgeSit', dur: rand(5, 9) }); }
    }
    _smoke(x, y, n) { const s = this.scale; for (let i = 0; i < n; i++) this._spawn('smoke', x + rand(-14, 14) * s, y - rand(0, 60) * s, rand(-25, 25) * s, -rand(15, 45) * s, rand(0.5, 0.9), rand(5, 10) * s); }
    _wake() { const T = this.task; if (T && T.type === 'sleep') { T.phase = 'wake'; T.wt = 0; this._emote('!', CYAN, 1); } }

    _chooseNext() {
      if (this.mode !== 'ground') return;
      if (this.queue.length) return this._start(this.queue.shift());
      if (this._greet) { this._greet = false; this._quip('hello', 0); }
      switch (this.state) {
        case 'sleep': return this._goToBed(false, true);
        case 'listening': return this._start({ type: 'listen' });
        case 'thinking': return this._start({ type: 'think' });
        case 'talking': return this._start({ type: 'talk' });
        case 'alert': return this._start({ type: 'guard' });
        case 'happy': return this._start({ type: 'dance', dur: 2.8, revert: true });
      }
      if (this.userIdle > this.o.sleepAfter) return this._goToBed(true, true);
      if (!this.o.wander) return this._start({ type: 'idle', dur: rand(2, 4) });
      const s = this.scale, S = this.surface, targets = this._surfaces();
      const fp = this.o.followWindows !== false ? this._frontPerch() : null;
      if (fp && !(S.type === 'perch' && S.wid === fp.wid) && this.time - this._frontAt > 6 && this.time - this._lastFollow > 35) {
        // the window you are working in: go and keep you company on top of it
        this._lastFollow = this.time;
        const m = Math.min(30 * s, (fp.x2 - fp.x1) / 3);
        this.queue.push(Math.random() < 0.5 ? { type: 'peek' } : { type: 'edgeSit', dur: rand(6, 11) });
        return this._start({ type: 'hop', x: rand(fp.x1 + m, fp.x2 - m), y: fp.y });
      }
      const kind = weighted([
        ['peek', S.type === 'perch' && S.x2 - S.x1 >= 70 * s ? 7 : 0], ['bop', this.ambient.music ? 12 : 0], ['sig', 1.5],
        ['idle', 24], ['walk', 24], ['hop', targets.length > 1 ? 26 : 10], ['fly', 6], ['scan', 7], ['sit', 5],
        ['edgeSit', S.type === 'perch' ? 9 : 0],
        ['wave', this._cursorDist() < 300 && this.time - this.lastWave > 25 ? 14 : 0],
        ['flip', 3],
      ]);
      switch (kind) {
        case 'walk': {
          const m = this._edgeMargin(S);
          const x = clamp(this.x + rand(70, 320) * s * (Math.random() < 0.5 ? -1 : 1), S.x1 + m, S.x2 - m);
          if (Math.abs(x - this.x) < 20) return this._start({ type: 'idle', dur: rand(1, 2.5) });
          return this._start({ type: 'walk', x, run: Math.abs(x - this.x) > 220 * s && Math.random() < 0.3 });
        }
        case 'hop': { const tg = this._pickHop(targets); return this._start({ type: 'hop', x: tg.x, y: tg.y }); }
        case 'flip': return this._start({ type: 'hop', rel: true, dx: rand(-90, 90) * s, arc: 105 * s, flip: true });
        case 'peek': return this._start({ type: 'peek' });
        case 'bop': return this._start({ type: 'dance', dur: rand(2.6, 4) });
        case 'sig': this._signature(); return this.task ? undefined : this._start({ type: 'idle', dur: 1 });
        case 'fly': return this._start(this._flyTask(rand(0.12, 0.88) * this.W, rand(0.2, 0.55) * this.H, rand(1, 2.4)));
        case 'scan': return this._start({ type: 'scan', dur: rand(2, 3) });
        case 'sit': return this._start({ type: 'sit', dur: rand(4, 9) });
        case 'edgeSit': return this._start({ type: 'edgeSit', dur: rand(5, 10) });
        case 'wave': this.lastWave = this.time; return this._start({ type: 'wave', dur: 1.8 });
        default: return this._start({ type: 'idle', dur: rand(1.5, 4.5) });
      }
    }

    _pickHop(list) {
      const cur = this.surface, s = this.scale, cands = [];
      for (const S of list) {
        if (cur && S.type === cur.type && (S.type === 'floor' || (S.wid === cur.wid && S.x1 === cur.x1))) continue;
        const m = Math.min(30 * s, (S.x2 - S.x1) / 3);
        const x = rand(S.x1 + m, S.x2 - m);
        const d = Math.hypot(x - this.x, S.y - this.y);
        cands.push([{ x, y: S.y }, d < 50 ? 0.1 : d > 1200 ? 0.35 : 1]);
      }
      if (!cands.length) {
        const m = this._edgeMargin(cur);
        return { x: clamp(this.x + rand(120, 360) * s * (Math.random() < 0.5 ? -1 : 1), cur.x1 + m, cur.x2 - m), y: cur.y };
      }
      return weighted(cands);
    }

    _faceCursor(amt, force) {
      const c = this.cursor, dx = c.x - this.x;
      if ((force || this.time - c.at < 2.5) && Math.abs(dx) < 520 && Math.abs(c.y - this.y) < 520 && Math.abs(dx) > 14) this.turnT = Math.sign(dx) * amt;
      else this.turnT = this.facing * amt;
    }

    _runTask(dt) {
      const T = this.task;
      T.t += dt;
      const ground = this.mode === 'ground';
      switch (T.type) {
        case 'idle': this._faceCursor(0.4); if (T.t > T.dur) this._done(); break;
        case 'walk': {
          if (!ground) break;
          const S = this.surface, m = this._edgeMargin(S), tx = clamp(T.x, S.x1 + m, S.x2 - m), dx = tx - this.x;
          if (Math.abs(dx) < 2.5 || T.t > 14) { this._done(); break; }
          this.vxT = Math.sign(dx) * Math.min(T.run ? this.runSpeed() : this.walkSpeed(), Math.abs(dx) * 5 + 15);
          this.turnT = Math.sign(dx) * 0.85; this.pose = 'walk';
          break;
        }
        case 'hop': this._doHop(T, dt); break;
        case 'fly': this._doFly(T, dt); break;
        case 'wave': this.pose = 'wave'; this._faceCursor(0.25, true); if (T.t > (T.dur || 2)) this._done(); break;
        case 'bow': this.pose = 'bow'; this._faceCursor(0.25, true); if (T.t > (T.dur || 1.9)) this._done(); break;
        case 'salute': this.pose = 'salute'; this._faceCursor(0.25, true); if (T.t > (T.dur || 1.8)) this._done(); break;
        case 'fist': this.pose = 'fist'; this._faceCursor(0.25, true); if (T.t > (T.dur || 1.5)) this._done(); break;
        case 'react': {
          this.pose = 'react'; this._faceCursor(0.25, true);
          if (!T.go) {
            T.go = true;
            const mark = { yawn: ['z', '#8aa0c8', 1.6], mail: ['✉', CYAN, 2.2], wrist: ['⏰', PAL.amber, 2], laugh: ['ha!', CYAN, 1.2], cheer: ['✦', PAL.amber, 1.4], sad: ['…', '#8aa0c8', 1.8], gasp: ['!', PAL.amber, 1.1] }[T.kind];
            if (mark) this._emote(mark[0], mark[1], mark[2], 1.15);
            if (T.kind === 'gasp') this.timers.surprised = 1.1;
            if (T.kind === 'cheer' || T.kind === 'laugh') this.timers.happy = T.dur;
          }
          if (T.kind === 'laugh' && (!T.beat || T.t > T.beat) && T.t < T.dur - 0.4) { T.beat = T.t + 0.55; this._emote('ha!', CYAN, 0.6, 1); }
          if (T.t > T.dur) this._done();
          break;
        }
        case 'transform': {   // changing outfits: spin in a burst of light, swap at the brightest moment, land, greet
          const d = T.dur || 1.9, s2 = this.scale;
          this.pose = 'transform'; this.turnT = this.facing * 0.2;
          if (!T.sp || T.t > T.sp) { T.sp = T.t + 0.045; const a = T.t * 11; this._spawn('glint', this.x + Math.cos(a) * 44 * s2, this.y - (8 + (T.t / d) * 118) * s2, 0, -40 * s2, rand(0.5, 0.9), rand(2, 3.4) * s2); }
          if (!T.swapped && T.t >= d * 0.5) {
            T.swapped = true; const to = this._pendingOutfit || T.to; this._pendingOutfit = null; this._swapOutfit(to);
            for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; this._spawn('glint', this.x + Math.cos(a) * 20 * s2, this.y - 62 * s2 + Math.sin(a) * 20 * s2, Math.cos(a) * 150 * s2, Math.sin(a) * 150 * s2, rand(0.45, 0.75), rand(2, 3.4) * s2); }
          }
          if (T.t > d) { this._done(); this.timers.happy = 1.4; this._emote('✦', PAL.amber, 1.0, 1.2); this.queue.unshift({ type: 'wave', dur: 1.8 }); }
          break;
        }
        case 'sig': this._doSig(T, dt); break;
        case 'peek': this._doPeek(T, dt); break;
        case 'vanish': {   // shinobi: a puff of smoke, gone, and back
          this.pose = 'stand';
          if (T.tele && !T.moved && T.t > 0.5 && ground) { T.moved = true; const S = this.surface, m = this._edgeMargin(S); this.x = clamp(this.x + rand(170, 420) * this.scale * (Math.random() < 0.5 ? -1 : 1), S.x1 + m, S.x2 - m); }
          if (!T.p1 && T.t > 0.1) { T.p1 = true; this._smoke(this.x, this.y, 16); }
          if (!T.p2 && T.t > 0.85) { T.p2 = true; this._smoke(this.x, this.y, 10); }
          this._ghost = T.t > 0.22 && T.t < 0.85;
          if (T.t > (T.dur || 1.3)) { this._ghost = false; this._done(); }
          break;
        }
        case 'dance':
          this.pose = 'dance';
          this.turnT = 0.45 * (Math.sin(T.t * 2.35) > 0 ? 1 : -1);
          if (!T.beat || T.t > T.beat) { const nk = this._outfit().note; T.beat = T.t + 0.9; this._emote('♪', nk > 1 ? NEON : CYAN, 0.9, nk); }
          if (T.t > (T.dur || 3)) { this._done(); if (T.revert && this.state === 'happy') this.setState('idle'); }
          break;
        case 'scan': this.pose = 'scan'; this.turnT = Math.sin(T.t * 2.6) > 0 ? 0.9 : -0.9; if (T.t > (T.dur || 2.6)) this._done(); break;
        case 'sit':
          this.pose = 'sit'; this.turnT = this.facing * 0.7;
          if (this.state === 'idle' && this.userIdle > this.o.sleepAfter) { this._goToBed(true, true); break; }
          if (T.t > T.dur) this._done();
          break;
        case 'edgeSit': this._doEdgeSit(T, dt); break;
        case 'sleep': this._doSleep(T, dt); break;
        case 'stretch': this.pose = 'stretch'; if (T.t > 1.3) this._done(); break;
        case 'listen': this.pose = 'listen'; this.turnT = 0; break;
        case 'think': this._doThink(T, dt); break;
        case 'talk': this.pose = 'talk'; this.turnT = 0.15 * this.facing; break;
        case 'guard':
          if (!T.jumped && ground) { T.jumped = true; this.vy = -520 * Math.sqrt(this.scale); this._toAir(); }
          this.pose = 'guard'; this.turnT = 0.25 * this.facing;
          break;
        case 'held': break;
        case 'draw':
          this.pose = 'draw'; this._faceCursor(0.6, true);
          if (!T.out && T.t > 0.42) { T.out = true; this.armed = true; this.swordFlash = 1; this._emote('!', CYAN, 0.8); this._slashSparks(8); }
          if (T.t > (T.dur || 1.15)) this._done();
          break;
        case 'sheathe':
          this.pose = 'sheathe'; this.turnT = 0.5 * this.facing;
          if (!T.in && T.t > 0.5) { T.in = true; this.armed = false; }
          if (T.t > (T.dur || 1.0)) this._done();
          break;
        case 'flourish':
          this.pose = 'flourish'; this._faceCursor(0.6, true);
          if (!T.fx && T.t > 0.3) { T.fx = true; this.swordFlash = 0.8; this._slashSparks(6); }
          if (T.t > (T.dur || 1.1)) this._done();
          break;
        case 'fight': this._doFight(T, dt); break;
        case 'kata': this._doKata(T, dt); break;
        default: this._done();
      }
    }

    // Shadow fighting: ready → advance+slash → overhead chop → dodge back → thrust → spin slash (turns around) →
    // low sweep → flurry → leaping chop → finish. Loops, alternating direction, until dur runs out.
    static get PERFORMANCES() { return new Set(['dance', 'fight', 'kata', 'draw', 'sheathe', 'flourish', 'wave', 'bow', 'salute', 'fist', 'vanish', 'react', 'transform', 'sig', 'peek']); }
    static get KATA() { return [['ready', 0.7], ['advance', 1.1], ['overhead', 0.7], ['dodge', 0.7], ['thrust', 0.6], ['spin', 0.9], ['sweep', 0.7], ['flurry', 1.3], ['leap', 1.1], ['finish', 1.2]]; }
    _doKata(T, dt) {
      const s = this.scale, ground = this.mode === 'ground', moves = Grit.KATA;
      const total = moves.reduce((a, m) => a + m[1], 0);
      const loop = Math.floor(T.t / total), seq = T.t - loop * total;
      let acc = 0, phase = 'ready', local = 0;
      for (const [name, d] of moves) { if (seq < acc + d) { phase = name; local = seq - acc; break; } acc += d; }
      if (T.phase !== phase) { T.phase = phase; T.phaseStart = T.t; T.jumped = false; T.spinDir = 0; }
      T.local = local;
      this.pose = 'kata';
      const S = this.surface || this._floor(), m = 130 * s;
      const hit = (n, sparks = 6, em = null) => { const k = `${loop}:${phase}:${n}`; if (!T[k]) { T[k] = true; this.swordFlash = 1; this._slashSparks(sparks); if (em) this._emote(em, PAL.amber, 0.5); } };
      switch (phase) {
        case 'ready':
          if (loop === 0 && local < 0.3) this._faceCursor(0.85, true);
          // don't fight your way off the edge of the floor: turn around if the run is nearly over
          if (ground && ((this.facing > 0 && this.x > S.x2 - m) || (this.facing < 0 && this.x < S.x1 + m))) this.turnT = -this.facing * 0.85;
          else this.turnT = this.facing * 0.85;
          break;
        case 'advance':
          this.turnT = this.facing * 0.85;
          if (ground && local < 0.7) this.vxT = this.facing * this.walkSpeed() * 1.3;
          if (local > 0.8) hit(1, 6);
          break;
        case 'overhead': this.turnT = this.facing * 0.85; if (local > 0.32) hit(1, 8, '!'); break;
        case 'dodge':
          this.turnT = this.facing * 0.85;
          if (ground && !T.jumped && local < 0.15) { T.jumped = true; this.vy = -330 * Math.sqrt(s); this.vx = -this.facing * 190 * s; this._toAir(); }
          break;
        case 'thrust': this.turnT = this.facing * 0.85; if (ground && local < 0.3) this.vxT = this.facing * this.runSpeed() * 1.1; if (local > 0.12) hit(1, 5); break;
        case 'spin':
          if (!T.spinDir) T.spinDir = -this.facing;
          this.turnT = T.spinDir * 0.9;
          if (local > 0.45) hit(1, 9, '!');
          break;
        case 'sweep': this.turnT = this.facing * 0.85; if (local > 0.35) hit(1, 7); break;
        case 'flurry':
          this.turnT = this.facing * 0.85;
          if (ground) this.vxT = this.facing * this.walkSpeed() * 0.8;
          if (local > 0.22) hit(1, 4); if (local > 0.62) hit(2, 4); if (local > 1.02) hit(3, 6);
          break;
        case 'leap':
          this.turnT = this.facing * 0.85;
          if (ground && !T.jumped && local < 0.15) { T.jumped = true; this.vy = -520 * Math.sqrt(s); this.vx = this.facing * 220 * s; this._toAir(); }
          if (ground && T.jumped && local > 0.5) { hit(1, 12, '!'); if (!T[`${loop}:leapdust`]) { T[`${loop}:leapdust`] = true; this._dust(this.x, this.y, 6, 120); } }
          break;
        case 'finish': this.turnT = this.facing * 0.85; if (local > 0.8) hit(1, 5); break;
      }
      if (T.t > (T.dur || 18) && (phase === 'finish' || phase === 'ready')) { this._done(); this._emote('★', PAL.amber, 1.4); }
      else if (T.t > (T.dur || 18) + total) this._done();
    }

    // A short sword routine: stance → slash → lunge → jump-slash → double slash → twirl. Stays armed afterwards.
    _doFight(T, dt) {
      const ground = this.mode === 'ground';
      this.pose = 'fight';
      const seq = T.t % 6;   // the routine loops every 6 s until dur runs out
      T.phase = seq < 0.7 ? 'stance' : seq < 1.3 ? 'slash' : seq < 1.8 ? 'stance' : seq < 2.4 ? 'lunge'
              : seq < 2.9 ? 'stance' : seq < 3.9 ? 'jump' : seq < 5.0 ? 'double' : 'twirl';
      T.local = seq - { stance: seq < 0.7 ? 0 : seq < 1.8 ? 1.3 : 2.4, slash: 0.7, lunge: 1.8, jump: 2.9, double: 3.9, twirl: 5.0 }[T.phase];
      if (T.phase === 'stance') this._faceCursor(0.85, true); else this.turnT = this.facing * 0.85;
      if (T.phase === 'lunge' && ground && T.local < 0.3) this.vxT = this.facing * this.runSpeed() * 1.3;
      if (T.phase === 'jump' && ground && !T.jumped) { T.jumped = true; this.vy = -500 * Math.sqrt(this.scale); this._toAir(); }
      if (T.phase !== 'jump') T.jumped = false;
      const hits = [[0.95, 'h1'], [2.05, 'h2'], [3.15, 'h3'], [4.1, 'h4'], [4.55, 'h5'], [5.5, 'h6']];
      const cyc = Math.floor(T.t / 6);
      for (const [at, key] of hits) {
        const k = key + cyc;
        if (seq >= at && !T[k]) { T[k] = true; this.swordFlash = 1; this._slashSparks(key === 'h6' ? 10 : 6); if (key === 'h3' || key === 'h6') this._emote('!', PAL.amber, 0.6); }
      }
      if (T.t > (T.dur || 6)) { this._done(); this._emote('★', PAL.amber, 1.2); }
    }
    _slashSparks(n) {
      const s = this.scale, hd = this._head || { hx: 0, hy: -85 };
      const p = this._l2w(hd.hx + 26, hd.hy + 10);
      for (let i = 0; i < n; i++) this._spawn('spark', p.x + rand(-6, 6) * s, p.y + rand(-6, 6) * s, this.facing * rand(60, 260) * s, -rand(40, 220) * s, rand(0.25, 0.45), 2 * s);
    }

    _doHop(T, dt) {
      if (T.phase === 'crouch') {
        if (this.mode !== 'ground') { this._done(); return; }
        this.pose = 'crouch';
        const dir = Math.sign(T.x - this.x) || this.facing;
        this.turnT = dir * (Math.abs(T.x - this.x) < 10 ? 0.45 : 0.8);
        if (T.t > (T.rocket ? 0.3 : 0.16)) {
          this._launchTo(T.x, T.y, T.arc);
          T.phase = 'air'; T.airT = 0; T.flight = this._flightT;
          if (T.rocket) this._burst();
        }
        return;
      }
      T.airT += dt;
      if (T.flip) this.rot = -this.facing * TAU * smooth(clamp(T.airT / (T.flight * 0.9), 0, 1));
      if (T.rocket && this.vy < -150) this.thrustT = 1;
      if (this.mode === 'ground' || T.airT > 5) this._done();
    }

    _launchTo(tx, ty, arc) {
      const g = this.G;
      const apex = Math.max(Math.min(this.y, ty) - arc, this.heightPx() + 6);
      const h1 = Math.max(4, this.y - apex), h2 = Math.max(0, ty - apex);
      const T = Math.sqrt((2 * h1) / g) + Math.sqrt((2 * h2) / g);
      this.vy = -Math.sqrt(2 * g * h1);
      this.vx = (tx - this.x) / T;
      this._flightT = T;
      this._toAir();
      this.squash.vel -= 3.2;
    }

    _doFly(T, dt) {
      const s = this.scale, g = this.G;
      if (T.phase === 'start') {
        if (this.mode === 'ground') { this.vy = -380 * Math.sqrt(s); this._toAir(); this._burst(); }
        T.phase = 'go'; T.hold = 0;
      }
      if (T.phase === 'go' || T.phase === 'hold') {
        const ty = T.y + (T.phase === 'hold' ? Math.sin(this.time * 2.4) * 6 * s : 0);
        let ax = 13 * (T.x - this.x) - 7.2 * this.vx;
        let ay = 13 * (ty - this.y) - 7.2 * this.vy - g;
        const mag = Math.hypot(ax, ay), amax = 3400;
        if (mag > amax) { ax *= amax / mag; ay *= amax / mag; }
        if (ay > 0) ay = 0;
        this.thrustAcc = { ax, ay };
        this.thrustT = clamp(0.35 + -ay / (g * 1.6), 0.3, 1);
        if (Math.abs(this.vx) > 40) this.turnT = Math.sign(this.vx) * 0.7;
        if (T.phase === 'go' && Math.hypot(T.x - this.x, T.y - this.y) < 18 * s && Math.hypot(this.vx, this.vy) < 140) T.phase = 'hold';
        if (T.phase === 'hold') { T.hold += dt; if (T.summon) this._faceCursor(0.3, true); if (T.hold > T.dur) T.phase = 'drop'; }
        if (T.t > 7) T.phase = 'drop';
        if (T.phase === 'drop') { this.thrustAcc = null; this.thrustT = 0; }
      } else if (this.mode === 'ground' || T.t > 12) this._done();
    }

    _doEdgeSit(T, dt) {
      if (this.mode !== 'ground') return;
      const S = this.surface, s = this.scale;
      if (S.type !== 'perch' || S.x2 - S.x1 < 50 * s) { this._start({ type: 'sit', dur: rand(4, 7) }); return; }
      if (!T.side) T.side = this.x - S.x1 < S.x2 - this.x ? -1 : 1;
      const ex = T.side > 0 ? S.x2 - 5 * s : S.x1 + 5 * s;
      if (!T.sitting) {
        const dx = ex - this.x;
        if (Math.abs(dx) > 3 && T.t < 10) { this.vxT = Math.sign(dx) * Math.min(this.walkSpeed(), Math.abs(dx) * 5 + 15); this.turnT = Math.sign(dx) * 0.85; this.pose = 'walk'; return; }
        T.sitting = true; T.st = 0;
      }
      this.x = ex; T.st += dt;
      this.pose = 'edgeSit'; this.turnT = T.side * 0.75;
      if (T.st > T.dur) this._done();
    }

    _doSleep(T, dt) {
      if (this.mode !== 'ground') return;
      if (!T.phase) { T.phase = 'settle'; T.z = 0.8; }
      this.turnT = T.bed && this.inBed() ? (this.x > this.W / 2 ? -0.7 : 0.7) : this.facing * 0.7;   // in his corner he curls up facing the room
      if (T.phase === 'settle') { this.pose = 'sit'; if (T.t > 0.9) T.phase = 'zz'; return; }
      if (T.phase === 'zz') {
        this.pose = 'sleep';
        T.z -= dt; if (T.z <= 0) { T.z = 1.5; this._spawnZ(); }
        if (T.auto && this.userIdle < 1.2) this._wake();
        return;
      }
      this.pose = 'stretch'; T.wt += dt;
      if (T.wt > 1.3) { this._done(); if (T.bed && this.inBed()) this._leaveBed(); if (T.auto) this._quip('back', 0); }
    }

    _doThink(T, dt) {
      if (this.mode !== 'ground') return;
      this.pose = 'think';
      if (T.pace == null) { T.pace = rand(2.5, 4.5); T.home = this.x; }
      if (T.walkTo != null) {
        const dx = T.walkTo - this.x;
        if (Math.abs(dx) < 2.5) { T.walkTo = null; T.pace = T.t + rand(2.5, 5); }
        else { this.vxT = Math.sign(dx) * this.walkSpeed() * 0.7; this.turnT = Math.sign(dx) * 0.8; this.pose = 'walk'; }
        return;
      }
      this.turnT = 0.4 * this.facing;
      if (T.t > T.pace) { const S = this.surface, m = this._edgeMargin(S); T.walkTo = clamp(T.home + rand(-50, 50) * this.scale, S.x1 + m, S.x2 - m); }
    }

    /* ── physics ── */
    _toAir() { this.mode = 'air'; this.surface = null; }

    _physics(dt) {
      const s = this.scale;
      if (this.mode === 'peek') return;   // hanging behind a window: the peek task moves him
      if (this.mode === 'drag') return this._dragPhysics(dt);
      if (this.mode === 'ground') {
        const S = this.surface;
        this.vx = damp(this.vx, this.vxT, 14, dt);
        this.x += this.vx * dt;
        this.y = S.y;
        const half = 16 * s;
        if (this.x < half) { this.x = half; this.vx = 0; }
        if (this.x > this.W - half) { this.x = this.W - half; this.vx = 0; }
        if (S.type === 'perch' && (this.x < S.x1 - 3 || this.x > S.x2 + 3)) this._toAir();
        this.rot = damp(wrapPI(this.rot), 0, 16, dt);
        return;
      }
      let ax = 0, ay = this.G;
      if (this.thrustAcc) { ax += this.thrustAcc.ax; ay += this.thrustAcc.ay; }
      this.vx += ax * dt; this.vy = Math.min(this.vy + ay * dt, 3200);
      const py = this.y;
      this.x += this.vx * dt; this.y += this.vy * dt;
      const flipping = this.task && this.task.type === 'hop' && this.task.flip;
      if (this.thrustAcc) this.rot = damp(this.rot, clamp(this.vx * 0.0007, -0.4, 0.4), 6, dt);
      else if (!flipping) { this.rot += this.rotVel * dt; this.rotVel *= Math.exp(-1.2 * dt); }
      const half = 18 * s;
      if (this.x < half) { this.x = half; if (this.vx < 0) this._wall(-1); }
      else if (this.x > this.W - half) { this.x = this.W - half; if (this.vx > 0) this._wall(1); }
      const top = this.heightPx() + 2;
      if (this.y < top) { this.y = top; if (this.vy < 0) this.vy = -this.vy * 0.25; }
      if (this.vy >= 0) { const L = this._landing(py, this.y, this.x); if (L) this._land(L); }
    }

    _landing(py, ny, x) {
      let best = null;
      const f = this._floor();
      if (ny >= f.y) { best = f; this.y = f.y; }
      const minY = this.heightPx() + 4;
      for (const p of this._allPerches()) {
        if (p.y < py - 0.5 || p.y > ny || p.y < minY) continue;
        if (x < p.x1 + 4 || x > p.x2 - 4) continue;
        if (!best || p.y < best.y) best = Object.assign({ type: 'perch' }, p);
      }
      return best;
    }

    _land(S) {
      const impact = this.vy;
      this.mode = 'ground'; this.surface = S; this.y = S.y; this.vy = 0;
      this.vx *= 0.3; this.rotVel = 0;
      if (this._tumbled) { this._tumbled = false; this.timers.dizzy = 1.5; }
      if (this.thrustAcc) this.thrustAcc = null;
      if (this.task && this.task.type === 'fly') this._done();
      const k = clamp(impact / 1400, 0, 1.6);
      this.squash.vel += 2.5 + 6 * k;
      this.timers.land = 0.22;
      this._dust(this.x, this.y, (3 + 8 * k) | 0, 50 + 160 * k);
      if (impact > 1500) this._spawn('ring', this.x, this.y, 0, 0, 0.45, 16 * this.scale);
      if (this._thrown) {
        const th = this._thrown; this._thrown = null;
        if (th.spin > 7 || impact > 2100) { this.timers.dizzy = 1.5; if (Math.random() < 0.6) this._quip('thrown', 3); }
      }
      this.antenna.vel += (Math.random() < 0.5 ? -1 : 1) * 5 * k;
      this._emit('land', S.type);
    }

    _wall(dir) {
      const sp = Math.abs(this.vx);
      this.vx = -this.vx * 0.42;
      this.rotVel = -this.rotVel * 0.5 - dir * sp * 0.002;
      if (sp > 650) {
        const s = this.scale, n = 8 + ((sp / 200) | 0);
        for (let i = 0; i < n; i++) this._spawn('spark', this.x + dir * 14 * s, this.y - rand(30, 90) * s, -dir * rand(150, 600) * s, -rand(50, 500) * s, rand(0.25, 0.5), 1);
        this.timers.surprised = 0.6;
      }
    }

    _dragPhysics(dt) {
      const D = this.drag; if (!D) return;
      const nx = damp(this.x, D.px - D.ox, 30, dt), ny = damp(this.y, D.py - D.oy, 30, dt);
      this.vx = (nx - this.x) / dt; this.vy = (ny - this.y) / dt;
      const half = 18 * this.scale;
      this.x = clamp(nx, half, this.W - half); this.y = clamp(ny, this.heightPx() * 0.6, this.H);
      this.rotSpring.target = clamp(this.vx * 0.0011, -0.85, 0.85);
      this.rot = this.rotSpring.step(dt);
      this._shake = damp(this._shake || 0, Math.hypot(this.vx, this.vy), 3, dt);
    }

    /* ── animation ── */
    _animate(dt) {
      const t = this.time, s = this.scale;
      this.turn = damp(this.turn, clamp(this.turnT, -1, 1), this.mode === 'drag' ? 4 : 9, dt);
      if (Math.abs(this.turn) > 0.015) this.facing = this.turn < 0 ? -1 : 1;
      const u = Math.min(1, Math.abs(this.turn));
      const grounded = this.mode === 'ground', spd = Math.abs(this.vx);
      this.moveAmt = damp(this.moveAmt, grounded && this.pose === 'walk' ? clamp(spd / this.walkSpeed(), 0, 2.2) : 0, 10, dt);
      if (grounded) this.walkPhase += spd * dt * (Math.PI / (15 * s));

      const P = this._poseTargets(t, u);
      const kA = P.armK || 16;
      for (const side of ['near', 'far']) {
        const a = this.arms[side], b = P[side];
        a.a1 = damp(a.a1, b.a1, kA, dt); a.a2 = damp(a.a2, b.a2, kA, dt); a.sp = damp(a.sp || 0, b.sp || 0, kA, dt);
      }
      const kF = P.footK || 22;
      this.feet.near.x = damp(this.feet.near.x, P.fN.x, kF, dt); this.feet.near.y = damp(this.feet.near.y, P.fN.y, kF, dt);
      this.feet.far.x = damp(this.feet.far.x, P.fF.x, kF, dt); this.feet.far.y = damp(this.feet.far.y, P.fF.y, kF, dt);
      this.hipDrop = damp(this.hipDrop, P.hip, 14, dt);
      this.bob = P.bob;
      this.headTilt = damp(this.headTilt, P.tilt, 8, dt);
      this.headDX = damp(this.headDX, P.hdx, 10, dt); this.headDY = damp(this.headDY, P.hdy, 10, dt);
      this._squashPose = P.squash;
      this._antT = P.antenna;
      const dvx = this.vx - (this._pvx || 0); this._pvx = this.vx;
      this.antenna.vel += clamp(-dvx * this.facing * 0.01, -4, 4);

      // eyes
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) { this.blinkT = 0.13; this.nextBlink = Math.random() < 0.15 ? 0.25 : rand(2, 5.5); }
      if (this.blinkT > 0) this.blinkT -= dt;
      const open = this.blinkT > 0 ? Math.abs((this.blinkT / 0.13) * 2 - 1) : 1;
      let lx = 0, ly = 0;
      const c = this.cursor;
      if (t - c.at < 4) {
        const hp = this._l2w(0, -84), dx = c.x - hp.x, dy = c.y - hp.y, d = Math.hypot(dx, dy) || 1, m = clamp(d / (240 * s), 0, 1);
        lx = (dx / d) * m * this.facing; ly = (dy / d) * m;
      }
      if (P.lookX != null) { lx = P.lookX; ly = P.lookY || 0; }
      this.look.x = damp(this.look.x, lx, 10, dt); this.look.y = damp(this.look.y, ly, 10, dt);
      const live = t - this.levelAt < 0.35;
      for (let i = 0; i < 5; i++) {
        const tg = live ? clamp(this.levelIn * (0.55 + 0.45 * noise(t * 9 + i * 3.1)) * (i === 2 ? 1 : i % 2 ? 0.85 : 0.65), 0, 1)
          : 0.12 + 0.55 * noise(t * 3.2 + i * 1.7) * (0.6 + 0.4 * Math.sin(t * 1.3 + i));
        this.levels[i] = damp(this.levels[i], tg, 18, dt);
      }
      const talking = (this.bubble && this.bubble.phase === 'type') || this.state === 'talking';
      this.talk = damp(this.talk, talking ? 0.35 + 0.65 * noise(t * 11) : 0, 14, dt);
      const tc = hexRgb(STATE_COLOR[this.state] || STATE_COLOR.idle);
      for (let i = 0; i < 3; i++) this.col[i] = damp(this.col[i], tc[i], 6, dt);
      this.glow = damp(this.glow, P.glow, 4, dt);
      this.thrust = damp(this.thrust, this.thrustT, 16, dt);

      const q = clamp(this.squash.value, -0.35, 0.42);
      const TK = this.task;
      const morph = TK && TK.type === 'transform' ? { k: Math.sin(Math.PI * clamp(TK.t / (TK.dur || 1.9), 0, 1)), spin: 4 * Math.PI * smooth(clamp(TK.t / (TK.dur || 1.9), 0, 1)) } : null;
      const sig = TK && TK.type === 'sig' ? { kind: TK.kind, t: TK.t, d: TK.dur, p: clamp(TK.t / TK.dur, 0, 1) } : null;
      this.A = {
        morph, sig, amb: this.ambient,
        t, u, facing: this.facing, sx: 1 + q * 0.55, sy: 1 - q,
        rot: this.rot + (P.lean || 0) * this.facing,
        hipDrop: this.hipDrop, bob: this.bob, headTilt: this.headTilt, headDX: this.headDX, headDY: this.headDY,
        antenna: clamp(this.antenna.value, -1, 1), arms: this.arms, feet: this.feet,
        eyes: { mode: this._eyeMode(P), open: open * (P.eyeOpen || 1), lx: this.look.x, ly: this.look.y, level: this.levels, talk: this.talk },
        col: this.col, glow: this.glow, thrust: this.thrust, shadow: grounded ? 1 : 0,
        sword: this.armed ? 1 : 0, swordFlash: this.swordFlash, swordTwist: P.swordTwist || 0,
        outfit: this.outfit, flame: this._outfit().flame, sway: clamp(-this.vx * 0.012, -4, 4) * this.facing, armFront: !!P.armFront, prop: P.prop || null,
      };
      this.swordFlash = damp(this.swordFlash, 0, 6, dt);
    }

    _eyeMode(P) {
      if (this.timers.dizzy > 0) return 'dizzy';
      if (this.timers.surprised > 0) return 'surprised';
      if (P.eyes) return P.eyes;
      switch (this.state) {
        case 'listening': return 'listen';
        case 'thinking': return 'think';
        case 'alert': return 'alert';
        case 'happy': return 'happy';
        case 'sleep': return 'sleep';
      }
      return this.timers.happy > 0 ? 'happy' : 'normal';
    }

    _poseTargets(t, u) {
      const nb = 7 - 4.5 * u, fb = -7 + 5.5 * u, br = Math.sin(t * 2.1);
      const arm = (a1, a2, sp) => ({ a1, a2, sp });
      const P = {
        hip: 0.7 * br, bob: 0, tilt: 0, hdx: 0, hdy: 0.4 * br, squash: 0, lean: 0,
        near: arm(0.1 + 0.03 * br, 0.32, 0.12), far: arm(0.06 - 0.03 * br, 0.32, 0.12),
        fN: { x: nb, y: 0 }, fF: { x: fb, y: 0 },
        antenna: -0.08 + 0.05 * Math.sin(t * 1.7), glow: 0.85 + 0.15 * Math.sin(t * 2.6),
      };
      if (this.mode === 'drag') {
        const sw = clamp(-this.vx * 0.006, -8, 8);
        P.fN = { x: nb + sw, y: 2.5 }; P.fF = { x: fb + sw * 0.8, y: 3.5 };
        P.near = arm(2.35 + 0.22 * Math.sin(t * 15), 0.35, 0.75); P.far = arm(2.3 + 0.22 * Math.sin(t * 15 + 2), 0.35, 0.75);
        P.hip = -1; P.antenna = -clamp(this.vx * 0.0008, -0.8, 0.8) * this.facing; P.footK = 10;
        if ((this._shake || 0) > 1500) P.eyes = 'dizzy';
        return P;
      }
      if (this.mode === 'air') {
        const T = this.task;
        if (T && T.type === 'kata') {
          const k = T.local || 0;
          if (T.phase === 'dodge') { P.near = arm(1.45, 0.55, 0.3); P.far = arm(1.6, 1.4, 0.25); P.fN = { x: nb + 2, y: -7 }; P.fF = { x: fb - 2, y: -5 }; P.eyes = 'alert'; }
          else { const r = smooth(clamp((k - 0.1) / 0.45, 0, 1)); P.near = arm(lerp(2.85, 0.55, r), 0.25, 0.3); P.far = arm(1.5, 1.5, 0.25); P.fN = { x: nb + 3, y: -9 }; P.fF = { x: fb - 2, y: -6 }; P.eyes = 'alert'; }
          P.hip = 3; P.armK = 36; P.footK = 30; P.antenna = -0.3;
          return P;
        }
        if (T && T.type === 'fight') {
          const r = smooth(clamp((T.local - 0.1) / 0.35, 0, 1));
          P.near = arm(lerp(2.8, 0.5, r), 0.3, 0.3); P.far = arm(1.5, 1.5, 0.25); P.fN = { x: nb + 3, y: -8 }; P.fF = { x: fb - 2, y: -5 };
          P.hip = 3; P.eyes = 'alert'; P.armK = 36; P.footK = 30; P.antenna = -0.3;
          return P;
        }
        if (this.thrustAcc) {
          P.fN = { x: nb + Math.sin(t * 3) * 2, y: -2 }; P.fF = { x: fb + Math.sin(t * 3 + 1.2) * 2, y: -1 };
          P.near = arm(0.7, 0.9, 0.35); P.far = arm(0.55, 0.8, 0.35); P.antenna = -0.35; P.hip = 2;
          return P;
        }
        if (T && T.type === 'hop' && T.flip && T.phase === 'air') {
          P.fN = { x: nb + 2, y: -11 }; P.fF = { x: fb + 1, y: -10 }; P.near = arm(1.3, 1.7, 0); P.far = arm(1.2, 1.8, 0);
          P.hip = 4; P.eyes = 'happy'; P.footK = 30; P.armK = 24;
          return P;
        }
        if (this.vy < -60) {
          P.fN = { x: nb + 3, y: -7 }; P.fF = { x: fb + 1, y: -5 };
          P.near = arm(-0.55, 0.35, 0.1); P.far = arm(-0.45, 0.35, 0.1); P.squash = -0.06; P.antenna = -0.5;
          if (T && T.rocket) P.eyes = 'alert';
        } else {
          const fl = this._thrown ? 1 : clamp(this.vy / 1400, 0, 1);
          P.fN = { x: nb + 1, y: 0 }; P.fF = { x: fb - 1, y: 1.5 };
          P.near = arm(1.1 + 1.1 * fl + 0.25 * Math.sin(t * 17) * fl, 0.45, 0.7);
          P.far = arm(1.0 + 1.1 * fl + 0.25 * Math.sin(t * 17 + 2) * fl, 0.5, 0.7);
          P.antenna = 0.45; P.squash = -0.04;
        }
        return P;
      }
      switch (this.pose) {
        case 'walk': {
          const ph = this.walkPhase, m = clamp(this.moveAmt, 0, 2.2), mm = Math.min(m, 1), run = clamp(m - 1, 0, 1);
          const amp = (7 + 5 * run) * mm, lift = (4.5 + 4 * run) * mm, sN = Math.sin(ph), cN = Math.cos(ph);
          P.fN = { x: nb + sN * amp, y: -Math.max(0, cN) * lift };
          P.fF = { x: fb - sN * amp, y: -Math.max(0, -cN) * lift };
          P.bob = -Math.abs(cN) * (1.6 + 1.6 * run) * mm;
          P.hip = 1 + 2 * run;
          P.near = arm(-sN * (0.6 + 0.35 * run) * mm, 0.35 + 0.6 * run, 0.06);
          P.far = arm(sN * (0.6 + 0.35 * run) * mm, 0.35 + 0.6 * run, 0.06);
          P.lean = 0.02 + 0.05 * run; P.hdy = P.bob * 0.3; P.antenna = -0.15 - 0.25 * run; P.footK = 40;
          break;
        }
        case 'crouch':
          P.hip = 9; P.squash = 0.14; P.near = arm(-0.85, 0.5, 0.15); P.far = arm(-0.75, 0.5, 0.15);
          P.fN.x = nb + 2; P.fF.x = fb - 2; P.antenna = 0.35;
          if (this.task && this.task.rocket) P.eyes = 'alert';
          break;
        case 'sit':
          P.hip = 17 + 0.5 * br; P.fN = { x: 15, y: 0 }; P.fF = { x: 11, y: -0.3 };
          P.near = arm(0.95, 0.15, 0.05); P.far = arm(0.8, 0.2, 0.05); P.tilt = 0.04;
          break;
        case 'edgeSit': {
          const k = Math.sin(t * 2.6);
          P.hip = 17; P.fN = { x: 8 + k * 3, y: 13 }; P.fF = { x: 4 - k * 3, y: 15 };
          P.near = arm(0.3, 0.15, 0.4); P.far = arm(0.25, 0.2, 0.4); P.tilt = 0.03 * Math.sin(t * 0.9);
          break;
        }
        case 'sleep': {
          const b2 = Math.sin(t * 1.25);
          P.hip = 18 + 0.8 * b2; P.fN = { x: 15, y: 0 }; P.fF = { x: 11, y: -0.3 };
          P.near = arm(0.6, 0.05, 0.05); P.far = arm(0.5, 0.1, 0.05);
          P.tilt = 0.2; P.hdy = 4 + 0.8 * b2; P.hdx = 2; P.antenna = -0.75; P.glow = 0.3 + 0.1 * b2; P.eyes = 'sleep';
          break;
        }
        case 'stretch':
          P.hip = -1.5; P.squash = -0.06; P.near = arm(2.5, 0.15, 0.85); P.far = arm(2.45, 0.2, 0.85);
          P.eyes = 'sleep'; P.tilt = -0.08; P.antenna = 0.3;
          break;
        case 'wave':
          P.near = arm(2.15, 0.45 + 0.5 * Math.sin(t * 11), 0.8); P.eyes = 'happy';
          P.tilt = 0.06 * Math.sin(t * 3); P.antenna = 0.2 * Math.sin(t * 6);
          break;
        case 'transform': {
          const k = this.A && this.A.morph ? this.A.morph.k : 0;
          P.near = arm(1.35, 0.2, 0.7); P.far = arm(1.3, 0.2, 0.7); P.squash = -0.1 * k; P.hip = -2 * k; P.eyes = 'happy'; P.glow = 1.6; P.antenna = 0.4; P.armK = 24;
          break;
        }
        case 'peek': {   // hanging behind a window's top edge by his fingertips, eyes just over it
          const T = this.task || {}, tt = T.t || 0;
          P.near = arm(2.45, 0.35, 0.55); P.far = arm(2.4, 0.35, 0.55); P.fN.y = 2; P.fF.y = 3; P.antenna = 0.25 * Math.sin(t * 5);
          if (tt > 1.5 && tt < 3.6) { P.lookX = Math.sin((tt - 1.5) * 2.6) * 0.95; P.lookY = -0.1; P.tilt = 0.06 * Math.sin((tt - 1.5) * 2.6); }
          if (tt > 2.5 && tt < 2.9) P.eyes = 'surprised';
          break;
        }
        case 'sig': {    // each outfit's own move (see _doSig)
          const T = this.task || {}, tt = T.t || 0, d = T.dur || 2;
          const k = smooth(clamp(tt / 0.3, 0, 1)) * (1 - smooth(clamp((tt - d + 0.35) / 0.35, 0, 1)));
          switch (T.kind) {
            case 'kaiju': {
              const roar = tt > 0.45 && tt < 1.45 ? 1 : 0, j = Math.sin(t * 55) * roar;
              P.near = arm(lerp(0.1, 2.05, k), 0.7, 1); P.far = arm(lerp(0.06, 2.0, k), 0.7, 1); P.lean = (tt < 0.45 ? -0.16 : 0.14) * k;
              P.hdx = 1.2 * j; P.squash = -0.07 * roar; P.eyes = roar ? 'alert' : 'happy'; P.antenna = 0.5 * j; P.armK = 26; P.glow = 1.3;
              break;
            }
            case 'oni': P.near = arm(1.75, 1.5, 0.9); P.far = arm(1.7, 1.5, 0.9); P.eyes = 'alert'; P.squash = tt < 0.25 ? 0.12 * (tt / 0.25) : 0; P.hip = tt < 0.25 ? 4 : 0; break;
            case 'drifter': {
              if (tt < 1.15) { const b = (tt > 0.42 && tt < 0.52) || (tt > 0.78 && tt < 0.88) ? 0.35 : 0; P.near = arm(1.5 + b, 0.06, 0.2); P.far = arm(0.5, 1.3, -0.1); P.lean = -0.05; P.eyes = 'alert'; P.armK = 34; }
              else { const h = smooth(clamp((tt - 1.15) / 0.25, 0, 1)) * (1 - smooth(clamp((tt - d + 0.3) / 0.3, 0, 1))); P.near = arm(lerp(0.1, 2.05, h), lerp(0.32, 1.05, h), 0.9); P.armFront = h > 0.5; P.tilt = 0.1 * h; P.eyes = 'happy'; }
              break;
            }
            case 'pirate': P.near = arm(lerp(0.1, 2.0, k), 0.25, 0.9); P.eyes = 'happy'; P.tilt = -0.08 * k; P.lookX = Math.cos(tt / d * TAU) * 0.8; P.lookY = -0.5; break;
            case 'vampire': {
              const open = tt > 1.25;
              if (!open) { P.near = arm(0.75, 1.55, -0.25); P.far = arm(0.7, 1.55, -0.25); P.tilt = 0.12 * k; P.hdy = 2 * k; P.eyeOpen = 0.6; }
              else { P.near = arm(1.9, 0.2, 1); P.far = arm(1.85, 0.2, 1); P.squash = -0.05; P.eyes = 'alert'; P.armK = 30; }
              break;
            }
            case 'reaper': {
              const w = clamp(tt / 0.5, 0, 1), sw = smooth(clamp((tt - 0.5) / 0.22, 0, 1));
              P.near = arm(lerp(lerp(0.3, 2.7, smooth(w)), 0.35, sw), 0.25, 0.8); P.lean = lerp(-0.12 * w, 0.2, sw) * k; P.eyes = 'alert'; P.armK = 30; P.far = arm(0.6, 0.9, 0.2);
              break;
            }
            case 'shark': { const c = (tt > 1.1 && tt < 1.3) || (tt > 1.55 && tt < 1.75); P.near = arm(1.2, 1.0, 0.6); P.far = arm(1.15, 1.0, 0.6); P.lean = 0.14 * k; P.eyes = c ? 'happy' : 'alert'; P.hdy = c ? 2 : 0; break; }
            case 'pharaoh': { const b = Math.sin(t * 10.4); P.near = arm(1.55, 1.55, 0.25); P.far = arm(-0.55, -1.2, 0.25); P.hdx = 3.2 * b * k; P.hip = 1.2 * Math.abs(b); P.fN.y = -Math.max(0, b) * 2.5; P.fF.y = -Math.max(0, -b) * 2.5; P.eyes = 'happy'; break; }
            case 'knight': P.near = arm(lerp(0.3, 1.75, k), 1.25, 0.5); P.far = arm(lerp(0.06, 2.2, k), 0.15, 0.9); P.squash = -0.05 * k; P.eyes = 'alert'; P.lean = -0.05 * k; break;
            default: P.lean = 0.3 * k; P.tilt = 0.26 * k; P.hdy = 3 * k; P.near = arm(0.1 + 0.3 * k, 0.3, 0.1); P.far = arm(0.06 + 0.25 * k, 0.3, 0.1); P.eyeOpen = 1 - 0.5 * k; P.glow = 1.5;   // spirit: a bow inside the spiral
          }
          break;
        }
        case 'bow': {   // ronin / spirit: a slow bow from the hips
          const T = this.task, tt = T ? T.t : 0, d = (T && T.dur) || 1.9;
          const k = smooth(clamp(tt / 0.4, 0, 1)) * (1 - smooth(clamp((tt - d + 0.5) / 0.5, 0, 1)));
          P.lean = 0.32 * k; P.tilt = 0.28 * k; P.hdy = 3 * k; P.hip = 2 * k; P.antenna = -0.45 * k;
          P.near = arm(0.1 + 0.3 * k, 0.3, 0.1); P.far = arm(0.06 + 0.25 * k, 0.3, 0.1); P.eyeOpen = 1 - 0.55 * k;
          break;
        }
        case 'salute': {   // pilot: crisp salute, hold, drop
          const T = this.task, tt = T ? T.t : 0, d = (T && T.dur) || 1.8;
          const k = smooth(clamp(tt / 0.3, 0, 1)) * (1 - smooth(clamp((tt - d + 0.35) / 0.35, 0, 1)));
          P.near = arm(lerp(0.1, 2.05, k), lerp(0.32, 1.05, k), 0.9); P.armFront = k > 0.5; P.squash = -0.03 * k; P.antenna = 0.25 * k; if (k > 0.6) P.eyes = 'alert';
          break;
        }
        case 'react': {   // yawn / mail / wrist / laugh / cheer / sad / gasp
          const T = this.task || {}, tt = T.t || 0, d = T.dur || 2;
          const k = smooth(clamp(tt / 0.3, 0, 1)) * (1 - smooth(clamp((tt - d + 0.35) / 0.35, 0, 1)));
          switch (T.kind) {
            case 'yawn':
              P.near = arm(lerp(0.1, 2.15, k), 0.35, 1); P.far = arm(lerp(0.06, 2.1, k), 0.4, 1); P.eyes = 'sleep';
              P.tilt = -0.14 * k; P.squash = -0.06 * k; P.hip = -1.5 * k; P.antenna = -0.5 * k; P.glow = 0.5;
              break;
            case 'mail':
              P.near = arm(lerp(0.1, 2.2, k), 0.5 + 0.25 * Math.sin(t * 7), 0.85); P.eyes = 'happy'; P.prop = 'mail';
              P.tilt = 0.05 * Math.sin(t * 3); P.antenna = 0.25 * Math.sin(t * 6);
              break;
            case 'wrist':
              P.far = arm(lerp(0.06, 1.25, k), lerp(0.3, 1.5, k), -0.35); P.near = arm(lerp(0.1, 1.2, k) + 0.1 * Math.sin(t * 15) * k, lerp(0.3, 1.55, k), -0.25);
              P.tilt = 0.14 * k; P.hdy = 2 * k; P.lookX = -0.5; P.lookY = 0.7; P.eyes = 'alert';
              break;
            case 'laugh': {
              const b = Math.sin(t * 19);
              P.near = arm(0.7, 1.5, -0.2); P.far = arm(0.65, 1.5, -0.2); P.eyes = 'happy'; P.tilt = -0.12 * k;
              P.bob = -1.5 * Math.abs(b) * k; P.hip = 1.5 + 1.2 * b * k; P.antenna = 0.3 * b; P.armK = 30;
              break;
            }
            case 'cheer': {
              const b = Math.sin(t * 12);
              P.near = arm(2.2 + 0.12 * b, 0.3, 1); P.far = arm(2.15 - 0.12 * b, 0.3, 1); P.eyes = 'happy';
              P.squash = -0.07 * k + 0.03 * b; P.hip = -1 + 1.5 * b; P.fN.y = -Math.max(0, b) * 3; P.fF.y = -Math.max(0, -b) * 3; P.antenna = 0.4 * b; P.armK = 30;
              break;
            }
            case 'sad':
              P.near = arm(0.02, 0.12, 0.05); P.far = arm(0.02, 0.12, 0.05); P.tilt = 0.24 * k; P.hdy = 5 * k; P.hdx = 1.5 * k;
              P.antenna = -0.85 * k; P.glow = 0.4; P.eyeOpen = 1 - 0.55 * k; P.hip = 2 * k; P.lookY = 0.8;
              break;
            case 'gasp':
              P.near = arm(1.7, 0.6, 0.85); P.far = arm(1.6, 0.6, 0.85); P.squash = -0.09 * k; P.antenna = 0.5 * k; P.tilt = -0.06 * k;
              break;
          }
          break;
        }
        case 'fist': {   // street: fist out, little bounce
          const b = Math.sin(t * 6);
          P.near = arm(1.5 + 0.05 * b, 0.05, -0.05); P.eyes = 'happy'; P.tilt = -0.05; P.bob = -1 + b * 0.6; P.antenna = 0.2 * b;
          break;
        }
        case 'dance': {
          const b = Math.sin(t * 9.4), up = b > 0;
          P.hip = 3 + 3 * b; P.squash = 0.05 * b;
          P.near = up ? arm(2.3, 0.35, 0.75) : arm(0.7, 1.4, 0.35);
          P.far = up ? arm(0.7, 1.4, 0.35) : arm(2.25, 0.35, 0.75);
          P.fN.y = -Math.max(0, b) * 3; P.fF.y = -Math.max(0, -b) * 3;
          P.eyes = 'happy'; P.armK = 24; P.antenna = 0.4 * Math.sin(t * 9.4);
          break;
        }
        case 'think':
          P.near = arm(2.05, 0.95, 0.9); P.far = arm(0.3, 0.9, 0.1); P.tilt = 0.12; P.hdx = 1; P.lookX = 0.6; P.lookY = -0.6;
          break;
        case 'listen':
          P.tilt = 0.1 + 0.05 * Math.sin(t * 1.4); P.antenna = 0.25 * Math.sin(t * 5) * (0.3 + this.levelIn);
          P.glow = 0.8 + 0.2 * this.levels[2]; P.near = arm(0.25, 0.4, 0.15);
          break;
        case 'talk': {
          const g = (noise(t * 2.3) - 0.5) * 2 * Math.max(this.talk, 0.3);
          P.near = arm(0.8 + 0.45 * g, 1.0 + 0.35 * g, 0.35); P.far = arm(0.15, 0.4, 0.12); P.tilt = 0.05 * Math.sin(t * 2.1);
          break;
        }
        case 'guard':
          P.hip = 4; P.near = arm(1.5, 1.6, 0.15); P.far = arm(1.4, 1.7, 0.15);
          P.fN.x = nb + 3; P.fF.x = fb - 3; P.eyes = 'alert'; P.antenna = 0.15 * Math.sin(t * 14);
          break;
        case 'scan':
          P.lookX = 0.85; P.hdx = 2; P.antenna = 0.2 * Math.sin(t * 4);
          break;
        case 'draw': {
          const T = this.task, k = T ? T.t : 0;
          if (k < 0.42) { const r = smooth(clamp(k / 0.42, 0, 1)); P.near = arm(2.0 + 0.95 * r, 1.1 - 0.5 * r, -0.35 * r); P.tilt = -0.08 * r; P.hdx = -1.5 * r; }
          else { const r = smooth(clamp((k - 0.42) / 0.3, 0, 1)); P.near = arm(lerp(2.95, 1.15, r), lerp(0.6, 0.55, r), lerp(-0.35, 0.35, r)); P.squash = -0.05 * (1 - r); P.eyes = 'alert'; }
          P.far = arm(0.9, 1.3, 0.3); P.hip = 3; P.fN.x = nb + 4; P.fF.x = fb - 4; P.armK = 30; P.antenna = 0.3;
          break;
        }
        case 'sheathe': {
          const T = this.task, k = T ? T.t : 0;
          const r = k < 0.5 ? smooth(clamp(k / 0.5, 0, 1)) : 1 - smooth(clamp((k - 0.5) / 0.45, 0, 1));
          P.near = arm(lerp(1.0, 2.95, r), lerp(0.5, 0.6, r), lerp(0.3, -0.35, r)); P.far = arm(0.3, 0.5, 0.15); P.tilt = -0.06 * r; P.armK = 26;
          break;
        }
        case 'flourish': {
          const T = this.task, k = T ? T.t : 0;
          P.near = arm(1.3 + 0.3 * Math.sin(k * 9), 0.2 + (k < 0.9 ? k * 7 : 0), 0.35); P.far = arm(1.2, 1.5, 0.3); P.hip = 3; P.eyes = 'happy'; P.armK = 40;
          P.fN.x = nb + 4; P.fF.x = fb - 4;
          break;
        }
        case 'fight': {
          const T = this.task, ph = T ? T.phase : 'stance', k = T ? T.local : 0;
          P.hip = 4; P.fN.x = nb + 5; P.fF.x = fb - 5; P.eyes = 'alert'; P.armK = 36; P.footK = 30; P.antenna = 0.15 * Math.sin(t * 14);
          P.far = arm(1.55, 1.45, 0.25);
          switch (ph) {
            case 'stance': P.near = arm(1.45 + 0.05 * Math.sin(t * 6), 0.45, 0.3); break;
            case 'slash': { const r = smooth(clamp(k / 0.3, 0, 1)); P.near = arm(lerp(2.5, 0.35, r), 0.25, 0.3); P.lean = 0.06 * r; P.squash = 0.04 * r; break; }
            case 'lunge': { const r = smooth(clamp(k / 0.25, 0, 1)); P.near = arm(1.55, 0.02, 0.1); P.lean = 0.14 * r; P.hip = 6; P.fN.x = nb + 10 * r; P.squash = -0.05 * r; break; }
            case 'jump': { const r = smooth(clamp((k - 0.15) / 0.4, 0, 1)); P.near = arm(lerp(2.7, 0.6, r), 0.3, 0.3); break; }
            case 'double': { const w = Math.sin(k * 11.5); P.near = arm(1.4 + 1.0 * w, 0.3, 0.3 + 0.2 * w); P.lean = 0.04 * w; P.swordTwist = 0.3 * w; break; }
            case 'twirl': { P.near = arm(1.35, k < 0.75 ? k * 8.4 : 0.45, 0.35); P.eyes = 'happy'; P.armK = 60; break; }
          }
          break;
        }
      }
      if (this.pose === 'kata') {
        const T = this.task, ph = T ? T.phase : 'ready', k = T ? T.local : 0;
        P.hip = 4; P.fN.x = nb + 5; P.fF.x = fb - 5; P.eyes = 'alert'; P.armK = 36; P.footK = 30; P.antenna = 0.15 * Math.sin(t * 14);
        P.far = arm(1.55, 1.45, 0.25);
        switch (ph) {
          case 'ready': P.near = arm(1.45 + 0.05 * Math.sin(t * 6), 0.45, 0.3); break;
          case 'advance': { const r = k < 0.7 ? 0 : smooth(clamp((k - 0.7) / 0.3, 0, 1)); P.near = arm(lerp(1.5, 0.4, r) + (k < 0.7 ? 0.1 * Math.sin(t * 9) : 0), 0.3, 0.3); P.lean = 0.05 + 0.05 * r; break; }
          case 'overhead': { const r = smooth(clamp((k - 0.05) / 0.3, 0, 1)); P.near = arm(lerp(2.95, 0.85, r), 0.2, 0.25); P.squash = 0.06 * r; P.hip = 4 + 4 * r; break; }
          case 'dodge': P.near = arm(1.45, 0.55, 0.3); P.hip = 6; break;
          case 'thrust': { const r = smooth(clamp(k / 0.2, 0, 1)); P.near = arm(1.55, 0.02, 0.1); P.lean = 0.14 * r; P.hip = 6; P.fN.x = nb + 10 * r; P.squash = -0.05 * r; break; }
          case 'spin': { const r = smooth(clamp((k - 0.15) / 0.5, 0, 1)); P.near = arm(lerp(2.4, 0.5, r), 0.3, 0.45); P.swordTwist = 0.25 * Math.sin(k * 7); P.lean = 0.04; break; }
          case 'sweep': { const r = smooth(clamp(k / 0.35, 0, 1)); P.hip = 10; P.squash = 0.12; P.near = arm(lerp(0.4, 1.35, r), 0.15, 0.4); P.fN.x = nb + 8; P.fF.x = fb - 4; break; }
          case 'flurry': { const w = Math.sin(k * 14); P.near = arm(1.4 + 1.0 * w, 0.3, 0.3 + 0.2 * w); P.lean = 0.05 * w; P.swordTwist = 0.3 * w; break; }
          case 'leap': P.near = arm(2.6, 0.3, 0.3); P.hip = 8; P.squash = 0.08; break;   // crouch before / impact after
          case 'finish': { P.near = arm(1.35, k < 0.7 ? k * 9 : 0.45, 0.35); if (k >= 0.7) P.eyes = 'happy'; P.armK = 60; break; }
        }
      }
      if (this.armed && !['draw', 'sheathe', 'flourish', 'fight', 'kata', 'dance', 'wave', 'crouch'].includes(this.pose)) {
        // carrying the sword: point low and forward, like a fencer at rest (walking keeps a little swing)
        const swing = this.pose === 'walk' ? 0.18 * Math.sin(this.walkPhase) * Math.min(this.moveAmt, 1) : 0.03 * br;
        P.near = arm(0.95 + swing, 0.2, 0.2);
      }
      if (this.state === 'idle' && this.mode === 'ground' && (this.pose === 'stand' || this.pose === 'sit') && !(this.task && Grit.PERFORMANCES.has(this.task.type))) {
        if (this.ambient.music) { const b = Math.sin(t * 12.6); P.hdy += 3.4 * Math.max(0, b); P.tilt += 0.08 * Math.sin(t * 6.3); P.hip += 1.3 * Math.max(0, b); P.antenna += 0.35 * b; }
        if (this.ambient.cold) { const j = Math.sin(t * 52); P.hdx += 0.9 * j; P.near = arm(0.75, 1.5, -0.2); P.far = arm(0.7, 1.5, -0.2); P.squash += 0.03; P.eyeOpen = 0.72; P.antenna += 0.15 * j; }
      }
      if (this.timers.land > 0) {
        const k = this.timers.land / 0.22;
        P.hip = Math.max(P.hip, 8 * k);
        P.near = arm(lerp(P.near.a1, 1.0, k), lerp(P.near.a2, 0.6, k), lerp(P.near.sp, 0.6, k));
        P.far = arm(lerp(P.far.a1, 0.8, k), lerp(P.far.a2, 0.6, k), lerp(P.far.sp, 0.6, k));
      }
      return P;
    }

    /* ── fx ── */
    _l2w(lx, ly) {
      const s = this.scale, f = this.facing, r = this.A ? this.A.rot : this.rot;
      const x = lx * f, y = ly + 58, c = Math.cos(r), sn = Math.sin(r);
      return { x: this.x + (x * c - y * sn) * s, y: this.y + (x * sn + y * c - 58) * s };
    }
    _spawn(k, x, y, vx, vy, life, r) { if (this.particles.length < 320) this.particles.push({ k, x, y, vx, vy, life, max: life, r, seed: Math.random() * 10 }); }
    _dust(x, y, n, sp) {
      const s = this.scale, fx = this._outfit().hopFx;
      if (fx === 'smoke') return this._smoke(x, y, n + 4);
      for (let i = 0; i < n; i++) { const d = i % 2 ? 1 : -1; this._spawn('dust', x + d * rand(2, 12) * s, y - 2, d * rand(0.3, 1) * sp * s, -rand(10, 60) * s, rand(0.35, 0.6), rand(3, 6) * s); }
      if (fx === 'spark') for (let i = 0; i < n; i++) this._spawn('spark', x + rand(-6, 6) * s, y - 2, rand(-1, 1) * sp * 1.5 * s, -rand(60, 260) * s, rand(0.2, 0.4), 1.5 * s);
      if (fx === 'sparkle') for (let i = 0; i < n + 2; i++) this._spawn('glint', x + rand(-16, 16) * s, y - rand(0, 30) * s, rand(-20, 20) * s, -rand(20, 70) * s, rand(0.5, 0.9), rand(1.5, 3) * s);
    }
    _burst() {
      const s = this.scale;
      for (let i = 0; i < 10; i++) this._exhaust(1.4);
      this._dust(this.x, this.y, 6, 140);
      for (let i = 0; i < 8; i++) this._spawn('pix', this.x + rand(-14, 14) * s, this.y - rand(0, 10) * s, rand(-120, 120) * s, -rand(40, 220) * s, rand(0.3, 0.6), rand(2, 3.2) * s);
    }
    _spawnZ() { const h = this._head || { hx: 0, hy: -85 }; const p = this._l2w(h.hx + 16, h.hy - 18); this._spawn('z', p.x, p.y, 0, -22 * this.scale, 1.8, 13 * this.scale); }
    _exhaust(boost = 1) {
      const u = this.A ? this.A.u : 0.5, s = this.scale;
      const hipY = -31 + this.hipDrop + this.bob, jx = 2 * u - 7 - 11 * u, sp = 5.5 * (1 - 0.3 * u);
      const w = this._l2w(jx + (Math.random() < 0.5 ? -1 : 1) * sp + rand(-1.5, 1.5), hipY + 4);
      const r = this.A ? this.A.rot : this.rot, dx = -Math.sin(r), dy = Math.cos(r);
      const v = rand(260, 420) * s * boost;
      this._spawn('flame', w.x, w.y, dx * v + this.vx * 0.25 + rand(-30, 30) * s, dy * v + this.vy * 0.25, rand(0.18, 0.34), rand(2.2, 4.2) * s);
    }
    _updateFx(dt) {
      if (this.thrust > 0.12 && !this.hidden) {
        this._spawnAcc += dt * 110 * this.thrust;
        while (this._spawnAcc >= 1) { this._spawnAcc -= 1; this._exhaust(); }
      } else this._spawnAcc = 0;
      const P = this.particles; let j = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i]; p.life -= dt; if (p.life <= 0) continue;
        switch (p.k) {
          case 'flame': p.vx *= Math.exp(-3 * dt); p.vy = p.vy * Math.exp(-3 * dt) - 60 * dt; break;
          case 'spark': p.vy += 1500 * dt; break;
          case 'dust': p.vx *= Math.exp(-5 * dt); p.vy = p.vy * Math.exp(-4 * dt) - 10 * dt; break;
          case 'z': p.vx = Math.sin(p.life * 4 + p.seed) * 12; break;
          case 'pix': p.vy += 300 * dt; p.vx *= Math.exp(-2 * dt); break;
          case 'smoke': p.vx *= Math.exp(-2 * dt); p.vy = p.vy * Math.exp(-2 * dt) - 20 * dt; break;
          case 'glint': p.vy -= 30 * dt; p.vx = Math.sin(p.life * 5 + p.seed) * 15; break;
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
        P[j++] = p;
      }
      P.length = j;
    }

    /* ── bubble ── */
    _updateBubble(dt) {
      const B = this.bubble; if (!B) return;
      B.t += dt;
      if (B.phase === 'type') {
        const n = Math.min(B.text.length, Math.floor(B.t * 52));
        if (n !== B.n) { B.n = n; this._typedEl.textContent = B.text.slice(0, n); this._restEl.textContent = B.text.slice(n); }
        if (n >= B.text.length) { B.phase = 'hold'; B.t = 0; }
      } else if (B.phase === 'hold') {
        if (B.t > B.hold) { B.phase = 'out'; B.t = 0; this.bubbleEl.classList.remove('grit-show'); }
      } else if (B.t > 0.25) {
        this.bubble = null;
        if (B.revert && this.state === B.revert) this.setState('idle');
        return;
      }
      this._placeBubble();
    }
    _placeBubble() {
      const el = this.bubbleEl;
      if (!this._bubbleSize) this._bubbleSize = { w: el.offsetWidth, h: el.offsetHeight };
      const { w, h } = this._bubbleSize, hd = this._head || { hx: 0, hy: -85 };
      const p = this._l2w(hd.hx, hd.hy - 30);
      const left = clamp(p.x - w / 2, 6, Math.max(6, this.W - w - 6));
      let top = p.y - h - 8, below = false;
      if (top < 6) { top = this.y + 8; below = true; }
      el.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
      el.classList.toggle('grit-below', below);
      this._tailEl.style.left = clamp(p.x - left - 5, 12, w - 22) + 'px';
    }

    /* ── render ── */
    _render() {
      const A = this.A; if (!A) return;
      const s = this.scale, k = this.dpr * s, ctx = this.ctx;
      this.cv.style.transform = `translate3d(${(this.x - AX * s).toFixed(2)}px,${(this.y - AY * s).toFixed(2)}px,0)`;
      const op = this._ghost ? '0' : ''; if (op !== this._opacity) { this._opacity = op; this.cv.style.opacity = op; }
      const clip = this._clipY != null ? `inset(0 0 ${Math.max(0, this.y - AY * s + BOX * s - this._clipY).toFixed(1)}px 0)` : '';
      if (clip !== this._clip) { this._clip = clip; this.cv.style.clipPath = clip; }
      usePalette(this.outfit);   // palette is module-wide: pick this bot's before painting
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      ctx.setTransform(k, 0, 0, k, AX * k, AY * k);
      A._seg = null;
      this._head = paint(ctx, A);
      if (this.emote) paintEmote(ctx, this.emote, A.facing * (this._head.hx + 22), this._head.hy - 32);
      // blade trail while the sword is moving fast (fight / shadow fighting / draw / flourish)
      const T = this.task;
      if (A._seg && T && (T.type === 'fight' || T.type === 'kata' || T.type === 'flourish' || T.type === 'draw')) {
        const a = this._l2w(A._seg.x0, A._seg.y0), b = this._l2w(A._seg.x1, A._seg.y1);
        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(b.x - last.b.x, b.y - last.b.y) > 3 * s) this.trail.push({ a, b, t: this.time });
      }
      while (this.trail.length && this.time - this.trail[0].t > 0.14) this.trail.shift();
      if (this.trail.length > 14) this.trail.splice(0, this.trail.length - 14);
      this._renderFx();
    }
    _renderFx() {
      const ctx = this.fctx, d = this.dpr;
      if (!this.particles.length && this.trail.length < 2) {
        if (this._fxDirty) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.fx.width, this.fx.height); this._fxDirty = false; }
        return;
      }
      this._fxDirty = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.fx.width, this.fx.height);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const col = this.col, s = this.scale;
      if (this.trail.length > 1) {   // the slash arc: translucent ribbon between successive blade positions
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 1; i < this.trail.length; i++) {
          const p = this.trail[i - 1], q = this.trail[i], age = clamp(1 - (this.time - q.t) / 0.14, 0, 1);
          ctx.fillStyle = rgbStr(col, 0.28 * age);
          ctx.beginPath(); ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y); ctx.lineTo(q.b.x, q.b.y); ctx.lineTo(q.a.x, q.a.y); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${0.35 * age})`; ctx.lineWidth = 1.2 * s;
          ctx.beginPath(); ctx.moveTo(p.b.x, p.b.y); ctx.lineTo(q.b.x, q.b.y); ctx.stroke();
        }
      }
      for (const p of this.particles) {
        const k = p.life / p.max;
        switch (p.k) {
          case 'flame': {
            ctx.globalCompositeOperation = 'lighter';
            const c = k > 0.66 ? [255, 236, 190] : k > 0.33 ? [255, 168, 70] : [255, 92, 44];
            ctx.fillStyle = rgbStr(c, 0.85 * k); circle(ctx, p.x, p.y, p.r * (0.45 + 0.55 * k)); ctx.fill();
            break;
          }
          case 'spark':
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = `rgba(255,190,90,${k})`; ctx.lineWidth = 1.6 * s; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025); ctx.stroke();
            break;
          case 'dust':
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = `rgba(160,178,205,${0.32 * k})`; circle(ctx, p.x, p.y, p.r * (1.7 - 0.7 * k)); ctx.fill();
            break;
          case 'ring': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = rgbStr(col, 0.7 * k); ctx.lineWidth = 2 * s;
            const R = p.r * (1 + (1 - k) * 4);
            ctx.beginPath(); ctx.ellipse(p.x, p.y, R, R * 0.22, 0, 0, TAU); ctx.stroke();
            break;
          }
          case 'z':
            ctx.globalCompositeOperation = 'source-over';
            ctx.font = `700 ${Math.round(p.r * (1.5 - 0.5 * k))}px ui-monospace, Menlo, monospace`;
            ctx.fillStyle = rgbStr(col, Math.min(1, k * 1.6) * 0.9); ctx.fillText('z', p.x, p.y);
            break;
          case 'pix':
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = rgbStr(col, k); ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
            break;
          case 'smoke':
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = `rgba(70,76,92,${0.55 * k})`; circle(ctx, p.x, p.y, p.r * (2.3 - 1.3 * k)); ctx.fill();
            break;
          case 'glint': {
            ctx.globalCompositeOperation = 'lighter';
            const R = p.r * (0.6 + 0.8 * Math.sin(k * Math.PI));
            ctx.fillStyle = `rgba(255,214,120,${k})`;
            ctx.beginPath(); ctx.moveTo(p.x, p.y - R * 2); ctx.lineTo(p.x + R * 0.6, p.y); ctx.lineTo(p.x, p.y + R * 2); ctx.lineTo(p.x - R * 0.6, p.y); ctx.closePath(); ctx.fill();
            break;
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ── test hook: freeze a pose (used by test/gallery.html) ── */
    debugPose(spec = {}) {
      GLOBAL.cancelAnimationFrame(this._raf);
      this.mode = spec.mode || 'ground'; this.state = spec.state || 'idle'; this.task = spec.task || null;
      this.surface = this.mode === 'ground' ? this._floor() : null;
      this.turn = this.turnT = spec.turn != null ? spec.turn : 0.5; this.facing = this.turn < 0 ? -1 : 1;
      this.vx = spec.vx || 0; this.vy = spec.vy || 0; this.walkPhase = spec.phase || 0;
      this.thrustAcc = spec.flying ? { ax: 0, ay: -this.G } : null;
      this.timers.dizzy = spec.dizzy ? 1 : 0; this.timers.surprised = spec.surprised ? 1 : 0; this.timers.land = 0;
      this.time = spec.t != null ? spec.t : 1;
      this.levelIn = spec.level || 0; this.levelAt = spec.level ? this.time : -99;
      this.col = hexRgb(STATE_COLOR[this.state]);
      this.blinkT = 0; this.nextBlink = 99;
      this.x = spec.x != null ? spec.x : this.x; this.y = spec.y != null ? spec.y : this._floor().y;
      for (let i = 0; i < 120; i++) {
        this.pose = spec.pose || 'stand';
        this.thrustT = spec.thrust || 0;
        this._animate(1 / 60);
        this.time = spec.t != null ? spec.t : 1;
      }
      this.squash.value = spec.squash || 0;
      this.antenna.value = this._antT || 0;
      this._animate(0.0001);
      if (spec.talk) this.A.eyes.talk = spec.talk;
      if (spec.emote) this.emote = { ch: spec.emote, color: CYAN, t: 0.3, dur: 2 };
      this._applyColorVars();
      this._render();
    }
  }

  Grit.STATES = STATES;
  Grit.paint = paint;
  GLOBAL.Grit = Grit;
  if (typeof module !== 'undefined' && module.exports) module.exports = Grit;
})(typeof window !== 'undefined' ? window : globalThis);
