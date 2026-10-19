/* ==========================================================================
   PEN FIGHT — gameplay script.
   Pulled out of the previous single-file build. The markup in index.html
   loads this file with `defer`, so every element it queries is in the DOM
   by the time this runs.
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------- utilities ---------------- */
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const hypot = (x, y) => Math.hypot(x, y);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const TAU = Math.PI * 2;
  const formatClock = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  function hexRgb(hex) {
    let h = (hex || '#d6533a').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, amt) {
    const c = hexRgb(hex);
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const m = (v) => Math.round(v + (t - v) * p);
    return 'rgb(' + m(c.r) + ',' + m(c.g) + ',' + m(c.b) + ')';
  }
  function powerColor(p) {
    if (p < .4) return '#5f9d7e';
    if (p < .62) return '#a9b84e';
    if (p < .8) return '#e8b83e';
    if (p < .92) return '#e07f35';
    return '#d64f36';
  }
  function rr(g, x, y, w, h, r) {
    const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, rad);
    else {
      g.moveTo(x + rad, y);
      g.arcTo(x + w, y, x + w, y + h, rad);
      g.arcTo(x + w, y + h, x, y + h, rad);
      g.arcTo(x, y + h, x, y, rad);
      g.arcTo(x, y, x + w, y, rad);
      g.closePath();
    }
    return g;
  }
  function seeded(seed) {
    let v = seed >>> 0;
    return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; };
  }

  /* ---------------- world & pen profiles ---------------- */
  const WORLD = { w: 1000, h: 560 };
  const TABLE = { x: 63, y: 51, w: 874, h: 458, r: 18 };
  const TABLE_RIGHT = TABLE.x + TABLE.w;
  const TABLE_BOTTOM = TABLE.y + TABLE.h;
  const TABLE_CX = TABLE.x + TABLE.w / 2;
  const TABLE_CY = TABLE.y + TABLE.h / 2;
  const STEP = 1 / 200;

  /*
    Physics tuning note:
    Launch speeds, drag and masses are balanced together so that even a
    perfect full-power centre hit from the starting marks pushes the rival
    roughly 120–205 world units — short of the ~250 units to the edge.
    Knockouts should come from positioning over several turns, not shot one.
  */
  const PROFILES = {
    speed: {
      key: 'speed', design: 'ball', name: 'Ball Pen', alias: 'Reynolds 045 style', mark: 'BALL 045',
      desc: 'Fast slide · light hit',
      feature: 'Ball pen — the longest, lightest pen. It zips across the desk and is easy to send too far, but its hits carry the least weight.',
      stats: { speed: 5, power: 2, control: 3 },
      mass: .75, length: 150, width: 13,
      launch: 1500, drag: 2.5, roll: 110, restitution: .18, spinNoise: .55
    },
    balanced: {
      key: 'balanced', design: 'gel', name: 'Gel Grip Pen', alias: 'Cello Gripper style', mark: 'GEL GRIP',
      desc: 'Steady slide · all-rounder',
      feature: 'Gel grip pen — rubber-gripped and predictable. Medium speed and weight with the calmest spin, so it is the easiest pen to place exactly where you want it.',
      stats: { speed: 3, power: 3, control: 5 },
      mass: 1.1, length: 142, width: 15,
      launch: 1410, drag: 2.3, roll: 100, restitution: .15, spinNoise: .25
    },
    heavy: {
      key: 'heavy', design: 'fountain', name: 'Fountain Pen', alias: 'Parker style', mark: 'FOUNTAIN',
      desc: 'Short slide · heavy hit',
      feature: 'Fountain pen — thick lacquered barrel with real heft. It launches slowest and stops soonest, but transfers the biggest thump and is hardest to budge.',
      stats: { speed: 2, power: 5, control: 3 },
      mass: 1.86, length: 136, width: 19,
      launch: 1300, drag: 2.1, roll: 85, restitution: .12, spinNoise: .4
    }
  };

  const PEN_COLORS = [
    { hex: '#d6533a', name: 'Coral red' },
    { hex: '#337cae', name: 'Ink blue' },
    { hex: '#3e8c6b', name: 'Chalk green' },
    { hex: '#d9a62e', name: 'Mustard' },
    { hex: '#7a5ba6', name: 'Grape ink' },
    { hex: '#3c3a34', name: 'Graphite' }
  ];

  // Both pens start upright (long axis vertical, tips pointing up), slightly
  // closer to the table centre so a single hit cannot reach an edge.
  const START = [
    { x: TABLE.x + TABLE.w * .34, y: TABLE_CY, angle: -Math.PI / 2 },
    { x: TABLE.x + TABLE.w * .66, y: TABLE_CY, angle: -Math.PI / 2 }
  ];

  const state = {
    mode: 'ai', difficulty: 'medium', series: 3,
    choices: ['balanced', 'speed'],
    colors: ['#d6533a', '#337cae'],
    editingPlayer: 0,
    started: false, paused: false, over: false, phase: 'setup',
    turn: 0, round: 1, scores: [0, 0], roundHistory: [],
    pens: [], aim: null, aiPlan: null, aiDeadline: 0,
    elapsed: 0, roundElapsed: 0, shotElapsed: 0, physicsTime: 0,
    settleTimer: 0, accumulator: 0, shotTouched: false, currentShooter: 0,
    hitCount: 0, fallCount: 0, lastClackAt: 0, lastHitAt: 0,
    toastTimer: null, shake: 0, trailAt: 0, lastClock: -1,
    matchOver: false, roundResult: null, resultIsDraw: false, pausedAt: 0
  };
  const effects = { sparks: [], dust: [], waves: [] };

  const targetWins = () => Math.ceil(state.series / 2);
  const isAiTurn = () => state.mode === 'ai' && state.turn === 1;
  const speedOf = (p) => hypot(p.vx, p.vy);
  const displayName = (i) => state.mode === 'ai' ? (i === 0 ? 'You' : 'Computer') : ('Player ' + (i + 1));
  const possessive = (n) => n === 'You' ? 'Your' : n + "'s";
  const nearestEdgeGap = (p) => Math.min(p.x - TABLE.x, TABLE_RIGHT - p.x, p.y - TABLE.y, TABLE_BOTTOM - p.y);

  function makePen(index) {
    const profile = PROFILES[state.choices[index]] || PROFILES.balanced;
    const s = START[index];
    const inertia = Math.max(1, profile.mass * (profile.length ** 2 + profile.width ** 2) / 12 * 1.35);
    return {
      index, profile, color: state.colors[index],
      x: s.x, y: s.y, angle: s.angle,
      vx: 0, vy: 0, omega: 0,
      mass: profile.mass, invMass: 1 / profile.mass,
      halfLength: profile.length / 2, halfWidth: profile.width / 2,
      inertia, invInertia: 1 / inertia,
      restitution: profile.restitution,
      out: false, outAt: 0, fallProgress: 0, fallDX: 0, fallDY: 1, trail: []
    };
  }
  const clonePen = (p) => ({ ...p, vx: 0, vy: 0, omega: 0, out: false, outAt: 0, fallProgress: 0, trail: [] });

  /* ---------------- rigid-body physics (OBB) ---------------- */
  function cornersOf(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle), hx = b.halfLength, hy = b.halfWidth;
    return [
      { x: b.x + c * hx - s * hy, y: b.y + s * hx + c * hy },
      { x: b.x + c * hx + s * hy, y: b.y + s * hx - c * hy },
      { x: b.x - c * hx + s * hy, y: b.y - s * hx - c * hy },
      { x: b.x - c * hx - s * hy, y: b.y - s * hx + c * hy }
    ];
  }
  function axesOf(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return [{ x: c, y: s }, { x: -s, y: c }];
  }
  function project(pts, ax) {
    let min = Infinity, max = -Infinity;
    for (const p of pts) { const v = p.x * ax.x + p.y * ax.y; if (v < min) min = v; if (v > max) max = v; }
    return { min, max };
  }
  function pointInBox(pt, b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const dx = pt.x - b.x, dy = pt.y - b.y;
    return Math.abs(dx * c + dy * s) <= b.halfLength + .15 && Math.abs(-dx * s + dy * c) <= b.halfWidth + .15;
  }
  function contactPoint(a, b) {
    const pts = [];
    for (const p of cornersOf(b)) if (pointInBox(p, a)) pts.push(p);
    for (const p of cornersOf(a)) if (pointInBox(p, b)) pts.push(p);
    if (!pts.length) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  function collisionInfo(a, b) {
    const ac = cornersOf(a), bc = cornersOf(b);
    let depth = Infinity, normal = null;
    for (const ax of [...axesOf(a), ...axesOf(b)]) {
      const pa = project(ac, ax), pb = project(bc, ax);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= 0) return null;
      if (overlap < depth) { depth = overlap; normal = ax; }
    }
    if (!normal) return null;
    if (normal.x * (b.x - a.x) + normal.y * (b.y - a.y) < 0) normal = { x: -normal.x, y: -normal.y };
    return { normal, depth, contact: contactPoint(a, b) };
  }
  function applyImpulse(b, ix, iy, rx, ry) {
    b.vx += ix * b.invMass;
    b.vy += iy * b.invMass;
    b.omega += (rx * iy - ry * ix) * b.invInertia;
  }
  function pointVel(b, rx, ry) { return { x: b.vx - b.omega * ry, y: b.vy + b.omega * rx }; }
  function resolveCollision(a, b) {
    const info = collisionInfo(a, b);
    if (!info) return null;
    const n = info.normal;
    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return null;

    const correction = Math.max(info.depth - .3, 0) / invSum * .7;
    a.x -= n.x * correction * a.invMass; a.y -= n.y * correction * a.invMass;
    b.x += n.x * correction * b.invMass; b.y += n.y * correction * b.invMass;

    const c = info.contact;
    const rax = c.x - a.x, ray = c.y - a.y, rbx = c.x - b.x, rby = c.y - b.y;
    const va = pointVel(a, rax, ray), vb = pointVel(b, rbx, rby);
    const vn = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y;
    if (vn > 0) return null;

    const raN = rax * n.y - ray * n.x, rbN = rbx * n.y - rby * n.x;
    const denom = invSum + raN * raN * a.invInertia + rbN * rbN * b.invInertia;
    if (denom <= 0) return null;
    const e = Math.abs(vn) < 35 ? 0 : Math.min(a.restitution, b.restitution);
    const j = Math.max(0, -(1 + e) * vn / denom);
    applyImpulse(a, -n.x * j, -n.y * j, rax, ray);
    applyImpulse(b, n.x * j, n.y * j, rbx, rby);

    // Tangential friction at the contact patch.
    const tx = -n.y, ty = n.x;
    const va2 = pointVel(a, rax, ray), vb2 = pointVel(b, rbx, rby);
    const vt = (vb2.x - va2.x) * tx + (vb2.y - va2.y) * ty;
    const raT = rax * ty - ray * tx, rbT = rbx * ty - rby * tx;
    const denomT = invSum + raT * raT * a.invInertia + rbT * rbT * b.invInertia;
    let jt = denomT > 0 ? -vt / denomT : 0;
    jt = clamp(jt, -j * .42, j * .42);
    applyImpulse(a, -tx * jt, -ty * jt, rax, ray);
    applyImpulse(b, tx * jt, ty * jt, rbx, rby);

    // A hit can transfer a lot of energy, but a pen lying flat on a wooden
    // desk cannot rocket away from a centre hit. Capping post-contact speed
    // guarantees that knockouts come from working a pen near an edge across
    // several turns, while a full-power miss can still slide off the desk.
    const POST_HIT_CAP = 700;
    for (const p of [a, b]) {
      p.omega = clamp(p.omega, -11, 11);
      p.vx = clamp(p.vx, -1700, 1700);
      p.vy = clamp(p.vy, -1700, 1700);
      const s = hypot(p.vx, p.vy);
      if (s > POST_HIT_CAP) { p.vx *= POST_HIT_CAP / s; p.vy *= POST_HIT_CAP / s; }
    }
    return { impact: j, x: c.x, y: c.y };
  }

  const isOffTable = (p) => p.x < TABLE.x || p.x > TABLE_RIGHT || p.y < TABLE.y || p.y > TABLE_BOTTOM;

  function stepPhysics(pens, dt, now, events) {
    for (const pen of pens) {
      if (pen.out) continue;
      const pr = pen.profile;
      let sp = speedOf(pen);
      if (sp > 0) {
        const damped = Math.max(0, sp * Math.exp(-pr.drag * dt) - pr.roll * dt);
        const k = damped / sp;
        pen.vx *= k; pen.vy *= k;
        sp = damped;
      }
      pen.omega *= Math.exp(-2.6 * dt);
      if (Math.abs(pen.omega) < .04) pen.omega = 0;
      if (sp < 5) { pen.vx = 0; pen.vy = 0; }

      pen.x += pen.vx * dt;
      pen.y += pen.vy * dt;
      pen.angle += pen.omega * dt;
      if (pen.angle > Math.PI) pen.angle -= TAU;
      if (pen.angle < -Math.PI) pen.angle += TAU;

      if (isOffTable(pen)) {
        const v = speedOf(pen);
        if (v > 1) { pen.fallDX = pen.vx / v; pen.fallDY = pen.vy / v; }
        else {
          const dx = pen.x - TABLE_CX, dy = pen.y - TABLE_CY, d = Math.max(1, hypot(dx, dy));
          pen.fallDX = dx / d; pen.fallDY = dy / d;
        }
        pen.out = true;
        pen.outAt = now;
        pen.vx = 0; pen.vy = 0; pen.omega = 0;
        if (events) events.falls.push(pen);
      }
    }
    if (pens[0].out || pens[1].out) return;
    for (let i = 0; i < 2; i++) {
      const hit = resolveCollision(pens[0], pens[1]);
      if (!hit) break;
      if (events && hit.impact > 1) events.impacts.push(hit);
    }
  }

  function launchBody(pen, angle, power, deterministic = false) {
    const a = Math.atan2(Math.sin(angle), Math.cos(angle));
    const pull = clamp(power, 0, 1);
    // Force ramps up gradually, so the middle of the meter is for placement
    // shots and only a deliberate long pull produces real knockout power.
    const force = .07 + .93 * Math.pow(pull, 1.5);
    const v = pen.profile.launch * force;
    pen.angle = a;
    pen.vx = Math.cos(a) * v;
    pen.vy = Math.sin(a) * v;
    pen.omega = deterministic ? 0 : (Math.random() - .5) * pen.profile.spinNoise;
    pen.out = false; pen.outAt = 0; pen.fallProgress = 0;
  }

  /* ---------------- AI (simulates with the real physics) ---------------- */
  function simulateCandidate(baseShooter, baseTarget, angle, power) {
    const shooter = clonePen(baseShooter);
    const target = clonePen(baseTarget);
    launchBody(shooter, angle, power, true);
    const startGap = nearestEdgeGap(target);
    let t = 0, bestImpact = 0;
    const step = 1 / 160;
    const events = { impacts: [], falls: [] };
    for (let i = 0; i < 640; i++) {
      t += step;
      events.impacts.length = 0;
      stepPhysics([shooter, target], step, t, events);
      for (const im of events.impacts) bestImpact = Math.max(bestImpact, im.impact);
      const sStop = shooter.out || speedOf(shooter) < 6;
      const tStop = target.out || speedOf(target) < 6;
      if (i > 30 && sStop && tStop) break;
    }
    let score = Math.min(bestImpact, 900) * .08 - power * 12;
    if (target.out && shooter.out) score += shooter.outAt < target.outAt ? 850 : -850;
    else if (target.out) score += 1000;
    else if (shooter.out) score -= 1200;
    const endGap = target.out ? -60 : nearestEdgeGap(target);
    score += (startGap - endGap) * 2.1;
    if (!shooter.out) score += clamp(nearestEdgeGap(shooter), 0, 110) * .45;
    return score;
  }

  function computeAiPlan() {
    const shooter = state.pens[1], target = state.pens[0];
    if (!shooter || !target) return { angle: Math.PI, power: .6 };
    const dx = target.x - shooter.x, dy = target.y - shooter.y;
    const dist = Math.max(1, hypot(dx, dy));
    const direct = Math.atan2(dy, dx);
    const base = clamp(.42 + dist / 900, .5, .95);

    if (state.difficulty === 'easy') {
      let angle = direct + (Math.random() - .5) * .5;
      let power = clamp(base * (.6 + Math.random() * .6), .3, 1);
      if (Math.random() < .16) { angle += (Math.random() < .5 ? -1 : 1) * (.4 + Math.random() * .4); power *= .85; }
      return { angle, power };
    }

    const pick = (cands) => cands
      .map(c => ({ ...c, score: simulateCandidate(shooter, target, c.angle, c.power) }))
      .sort((a, b) => b.score - a.score)[0];

    if (state.difficulty === 'medium') {
      const best = pick([
        { angle: direct, power: base },
        { angle: direct + .04, power: base },
        { angle: direct - .04, power: base },
        { angle: direct, power: clamp(base + .1, 0, 1) },
        { angle: direct + .02, power: clamp(base - .12, .3, 1) },
        { angle: direct - .02, power: clamp(base + .05, 0, 1) }
      ]);
      return {
        angle: best.angle + (Math.random() - .5) * .05,
        power: clamp(best.power * (.94 + Math.random() * .12), .25, 1)
      };
    }

    const cands = [];
    for (const off of [-.085, -.05, -.02, 0, .02, .05, .085])
      for (const pw of [.5, .65, .8, .9, 1])
        cands.push({ angle: direct + off, power: pw });
    const best = pick(cands);
    return { angle: best.angle + (Math.random() - .5) * .012, power: clamp(best.power, .25, 1) };
  }

  /* ---------------- synthesized sound ---------------- */
  const sound = {
    ctx: null, master: null, noiseBuf: null, muted: false, slideSrc: null, slideGain: null,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return true; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.muted = localStorage.getItem('penfight-muted') === '1';
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : .7;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * .7);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return true;
      } catch (e) { this.ctx = null; return false; }
    },
    ready() { return this.ctx && !this.muted; },
    tone(f0, f1, dur, vol = .08, type = 'triangle', delay = 0) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(30, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + .012);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + .03);
    },
    noise(dur, vol, freq, type = 'bandpass', endFreq = null, delay = 0) {
      if (!this.ready() || !this.noiseBuf) return;
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = .9;
      f.frequency.setValueAtTime(freq, t);
      if (endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(60, endFreq), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(Math.max(.0002, vol), t);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + .03);
    },
    click() { if (this.init()) this.tone(720, 500, .05, .04); },
    whoosh() { if (!this.init()) return; this.noise(.26, .22, 340, 'bandpass', 1700); this.tone(150, 92, .16, .03, 'sine'); },
    clack(s = .7) {
      if (!this.init()) return;
      const v = clamp(.05 + s * .16, .05, .26);
      this.tone(175 + Math.random() * 35, 90, .07, v);
      this.tone(900 + Math.random() * 200, 470, .032, v * .3, 'square');
      this.noise(.05, v * .7, 1900, 'highpass');
    },
    fall() { if (!this.init()) return; this.tone(250, 54, .4, .11); this.noise(.32, .12, 900, 'lowpass'); this.tone(70, 42, .18, .09, 'sine', .18); },
    roundWin() { [523.25, 659.25, 783.99].forEach((n, i) => this.tone(n, n, .16, .07, 'triangle', i * .09)); },
    victory() { if (!this.init()) return; [523.25, 659.25, 783.99, 1046.5].forEach((n, i) => { this.tone(n, n, .24, .08, 'triangle', i * .11); this.tone(n / 2, n / 2, .26, .035, 'sine', i * .11); }); },
    defeat() { if (!this.init()) return; [392, 349.23, 293.66, 261.63].forEach((n, i) => this.tone(n, n * .97, .26, .06, 'sawtooth', i * .13)); },
    slideStart() {
      if (!this.init() || !this.noiseBuf || this.slideSrc) return;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 760; f.Q.value = .55;
      const g = this.ctx.createGain(); g.gain.value = .0001;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      this.slideSrc = src; this.slideGain = g;
    },
    slideLevel(lv) { if (this.slideGain && this.ctx) this.slideGain.gain.setTargetAtTime(this.muted ? .0001 : clamp(lv * .032, .0001, .032), this.ctx.currentTime, .07); },
    slideStop() {
      if (!this.slideSrc || !this.ctx) return;
      const src = this.slideSrc, g = this.slideGain;
      this.slideSrc = null; this.slideGain = null;
      try { g.gain.setTargetAtTime(.0001, this.ctx.currentTime, .03); src.stop(this.ctx.currentTime + .18); } catch (e) {}
    },
    setMuted(m) {
      this.muted = !!m;
      try { localStorage.setItem('penfight-muted', this.muted ? '1' : '0'); } catch (e) {}
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : .7, this.ctx.currentTime, .03);
      if (this.muted) this.slideStop();
    }
  };
  try { sound.muted = localStorage.getItem('penfight-muted') === '1'; } catch (e) {}

  /* ---------------- canvas & board art ---------------- */
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const canvasShell = $('canvasShell');
  let renderScale = 1;
  let bgCanvas = null;

  function resizeCanvas() {
    const w = Math.max(1, canvas.clientWidth || canvasShell.clientWidth || 640);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.round(w * dpr), th = Math.round(w * (WORLD.h / WORLD.w) * dpr);
    if (canvas.width !== tw || canvas.height !== th) { canvas.width = tw; canvas.height = th; }
    renderScale = canvas.width / WORLD.w;
  }

  function buildBackground() {
    const off = document.createElement('canvas');
    off.width = WORLD.w; off.height = WORLD.h;
    const g = off.getContext('2d');
    const rnd = seeded(3022009);

    // Chalkboard (out of bounds)
    g.fillStyle = '#31594d';
    g.fillRect(0, 0, WORLD.w, WORLD.h);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(243,247,230,.05)';
      g.beginPath();
      g.ellipse(60 + rnd() * (WORLD.w - 120), 30 + rnd() * (WORLD.h - 80), 26 + rnd() * 42, 10 + rnd() * 16, rnd(), 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(233,243,222,.06)';
    for (let i = 0; i < 26; i++) {
      const y = rnd() * WORLD.h;
      g.beginPath(); g.moveTo(-10, y);
      for (let x = -10; x <= WORLD.w + 10; x += 40) g.lineTo(x, y + Math.sin(x * .02 + i) * 2);
      g.lineWidth = .6; g.stroke();
    }
    // chalk tray
    g.fillStyle = '#7a5733'; g.fillRect(0, 0, WORLD.w, 19);
    g.fillStyle = '#8f6a3f'; g.fillRect(0, 0, WORLD.w, 4);
    g.fillStyle = 'rgba(255,240,202,.25)'; g.fillRect(0, 17, WORLD.w, 2);
    [[96, '#f4f0dc'], [122, '#f4f0dc'], [884, '#f3d276']].forEach(([x, col]) => {
      g.save(); g.translate(x, 13); g.rotate((rnd() - .5) * .4);
      g.fillStyle = col; rr(g, -9, -3, 18, 6, 2); g.fill(); g.restore();
    });
    // Chalkboard marks and illustrations without baked-in labels.
    g.save();
    g.strokeStyle = 'rgba(240,246,229,.35)'; g.lineWidth = 1; g.setLineDash([2, 6]);
    rr(g, 12, 27, WORLD.w - 24, WORLD.h - 39, 8); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(241,244,223,.5)'; g.lineWidth = 1.1;
    g.beginPath(); g.arc(828, 482, 12, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      g.beginPath();
      g.moveTo(828 + Math.cos(a) * 16, 482 + Math.sin(a) * 16);
      g.lineTo(828 + Math.cos(a) * 21, 482 + Math.sin(a) * 21);
      g.stroke();
    }
    g.restore();

    // Table shadow
    g.save();
    g.shadowColor = 'rgba(10,30,24,.55)'; g.shadowBlur = 26; g.shadowOffsetY = 13;
    rr(g, TABLE.x, TABLE.y, TABLE.w, TABLE.h, TABLE.r);
    g.fillStyle = '#a9784a'; g.fill();
    g.restore();

    // Wooden desk
    g.save();
    rr(g, TABLE.x, TABLE.y, TABLE.w, TABLE.h, TABLE.r);
    g.clip();
    g.fillStyle = '#c08d57';
    g.fillRect(TABLE.x, TABLE.y, TABLE.w, TABLE.h);
    for (let y = TABLE.y, i = 0; y < TABLE_BOTTOM; y += 58, i++) {
      g.fillStyle = i % 2 ? 'rgba(255,240,205,.045)' : 'rgba(80,45,15,.045)';
      g.fillRect(TABLE.x, y, TABLE.w, 58);
    }
    for (let i = 0; i < 54; i++) {
      const y = TABLE.y + rnd() * TABLE.h;
      g.beginPath(); g.moveTo(TABLE.x - 8, y);
      for (let x = TABLE.x - 8; x <= TABLE_RIGHT + 10; x += 44)
        g.lineTo(x, y + Math.sin((x + i * 31) * .019) * (2 + rnd() * 3) + (rnd() - .5) * 1.4);
      g.strokeStyle = i % 4 === 0 ? 'rgba(92,54,25,.2)' : 'rgba(102,62,29,.1)';
      g.lineWidth = i % 5 === 0 ? 1.3 : .6;
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = TABLE.x + 120 + rnd() * (TABLE.w - 240), y = TABLE.y + 60 + rnd() * (TABLE.h - 120);
      g.strokeStyle = 'rgba(83,48,22,.16)'; g.lineWidth = .8;
      g.beginPath(); g.ellipse(x, y, 9 + rnd() * 14, 3 + rnd() * 4, rnd(), 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(87,52,24,.09)';
      g.beginPath(); g.ellipse(x, y, 16 + rnd() * 20, 5 + rnd() * 5, rnd(), 0, TAU); g.stroke();
    }
    // Faded pen-circle doodles, without decorative captions.
    g.save();
    g.strokeStyle = '#57391e'; g.lineWidth = 1; g.globalAlpha = .14;
    g.beginPath(); g.arc(TABLE_RIGHT - 106, TABLE.y + 84, 31, 0, TAU); g.stroke();
    g.beginPath(); g.arc(TABLE_RIGHT - 106, TABLE.y + 84, 26, .4, TAU - .3); g.stroke();
    g.restore();
    // centre stamp
    g.save();
    g.translate(TABLE_CX, TABLE_CY);
    g.globalAlpha = .24; g.strokeStyle = '#6c4827'; g.lineWidth = 1.2;
    g.setLineDash([4, 5]); g.beginPath(); g.arc(0, 0, 62, 0, TAU); g.stroke();
    g.setLineDash([]); g.beginPath(); g.arc(0, 0, 54, 0, TAU); g.stroke();
    g.restore();
    // edge ticks
    g.save();
    g.globalAlpha = .3; g.strokeStyle = '#fff1bf'; g.lineWidth = 1;
    for (let i = 0; i < 28; i++) {
      const x = TABLE.x + 26 + i * ((TABLE.w - 52) / 27);
      g.beginPath(); g.moveTo(x, TABLE.y + 12); g.lineTo(x, TABLE.y + 12 + (i % 5 === 0 ? 6 : 3)); g.stroke();
    }
    g.restore();
    // desk edge
    rr(g, TABLE.x + .5, TABLE.y + .5, TABLE.w - 1, TABLE.h - 1, TABLE.r);
    g.strokeStyle = 'rgba(255,239,190,.6)'; g.lineWidth = 1.3; g.stroke();
    rr(g, TABLE.x + 9, TABLE.y + 9, TABLE.w - 18, TABLE.h - 18, TABLE.r - 7);
    g.strokeStyle = 'rgba(255,239,190,.24)'; g.lineWidth = 1; g.setLineDash([3, 7]); g.stroke(); g.setLineDash([]);
    g.restore();

    // brass corner nails
    for (const [x, y] of [[TABLE.x + 22, TABLE.y + 22], [TABLE_RIGHT - 22, TABLE.y + 22], [TABLE.x + 22, TABLE_BOTTOM - 22], [TABLE_RIGHT - 22, TABLE_BOTTOM - 22]]) {
      g.beginPath(); g.arc(x, y, 3.2, 0, TAU);
      g.fillStyle = 'rgba(251,223,154,.7)'; g.fill();
      g.strokeStyle = 'rgba(89,59,28,.35)'; g.lineWidth = .8; g.stroke();
    }
    bgCanvas = off;
  }

  /* ---------------- effects ---------------- */
  function spawnSparks(x, y, strength, a, b) {
    const n = Math.round(clamp(4 + strength / 90, 4, 15));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const sp = 35 + Math.random() * Math.min(300, 80 + strength * .5);
      const life = .35 + Math.random() * .35;
      effects.sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size: .8 + Math.random() * 2.2, color: i % 3 === 0 ? '#ffe2a1' : (i % 3 === 1 ? a.color : b.color) });
    }
    effects.waves.push({ x, y, life: 1 });
  }
  function spawnDust(x, y) {
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * TAU, sp = 10 + Math.random() * 60, life = .5 + Math.random() * .5;
      effects.dust.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 8, life, max: life, size: 1.4 + Math.random() * 2.4 });
    }
  }
  function updateEffects(dt) {
    for (const s of effects.sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= Math.exp(-3 * dt); s.vy = s.vy * Math.exp(-3 * dt) + 70 * dt; }
    effects.sparks = effects.sparks.filter(s => s.life > 0);
    for (const d of effects.dust) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= Math.exp(-2 * dt); d.vy *= Math.exp(-2 * dt); }
    effects.dust = effects.dust.filter(d => d.life > 0);
    for (const w of effects.waves) w.life -= dt * 1.8;
    effects.waves = effects.waves.filter(w => w.life > 0);
  }
  function drawEffects() {
    for (const s of effects.sparks) {
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, TAU); ctx.fill();
    }
    for (const d of effects.dust) {
      ctx.globalAlpha = clamp(d.life / d.max, 0, 1) * .5;
      ctx.fillStyle = '#e8cc9a';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, TAU); ctx.fill();
    }
    for (const w of effects.waves) {
      ctx.globalAlpha = clamp(w.life, 0, 1) * .65;
      ctx.strokeStyle = '#ffe3ad'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(w.x, w.y, 4 + (1 - w.life) * 24, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- pen rendering (three real pen designs) ---------------- */
  function drawPenShadow(pen, fall) {
    ctx.save();
    ctx.translate(pen.x + 4 + fall * 14, pen.y + 7 + fall * 22);
    ctx.rotate(pen.angle);
    ctx.globalAlpha = .26 * (1 - fall * .7);
    ctx.fillStyle = '#28180d';
    rr(ctx, -pen.halfLength - 4, -pen.halfWidth - 1.5, pen.profile.length + 10, pen.profile.width + 3, pen.halfWidth + 1);
    ctx.fill();
    ctx.restore();
  }

  function drawPen(pen) {
    const p = pen.profile;
    const fall = pen.out ? clamp(pen.fallProgress, 0, 1) : 0;
    drawPenShadow(pen, fall);

    ctx.save();
    ctx.translate(pen.x + pen.fallDX * fall * 42, pen.y + pen.fallDY * fall * 42 + fall * fall * 26);
    ctx.rotate(pen.angle + fall * (pen.index === 0 ? -.6 : .6));
    const sc = 1 - fall * .6;
    ctx.scale(sc, sc);
    ctx.globalAlpha = 1 - fall * .85;

    const hl = pen.halfLength, hw = pen.halfWidth, len = p.length;
    const rad = Math.min(hw, 8);
    const col = pen.color;
    const light = shade(col, .32), dark = shade(col, -.22), darker = shade(col, -.42);
    const barrel = () => rr(ctx, -hl, -hw, len, hw * 2, rad);

    // barrel with banded shading (top light, bottom shade)
    barrel(); ctx.fillStyle = col; ctx.fill();
    ctx.save(); barrel(); ctx.clip();
    ctx.fillStyle = light; ctx.fillRect(-hl, -hw, len, hw * .62);
    ctx.fillStyle = dark; ctx.fillRect(-hl, hw * .45, len, hw * .55);
    ctx.fillStyle = 'rgba(255,252,238,.35)'; ctx.fillRect(-hl + 3, -hw + 1, len - 6, Math.max(1, hw * .22));
    ctx.restore();
    barrel(); ctx.strokeStyle = 'rgba(38,35,27,.6)'; ctx.lineWidth = .8; ctx.stroke();

    const clip = (x, w, fill) => {
      ctx.save();
      ctx.fillStyle = fill;
      rr(ctx, x, -hw - 2.6, w, 2.6, 1.2); ctx.fill();
      ctx.fillRect(x + 2, -hw - .6, 3, 2);
      ctx.restore();
    };
    const ballTip = () => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hl - 3, -hw * .78);
      ctx.lineTo(hl + 5, -1.7);
      ctx.quadraticCurveTo(hl + 7.4, 0, hl + 5, 1.7);
      ctx.lineTo(hl - 3, hw * .78);
      ctx.closePath();
      ctx.fillStyle = '#d8dde0'; ctx.fill();
      ctx.strokeStyle = 'rgba(52,61,69,.7)'; ctx.lineWidth = .65; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillRect(hl - 2, -hw * .45, 6, 1);
      ctx.beginPath(); ctx.arc(hl + 7.1, 0, 1.25, 0, TAU);
      ctx.fillStyle = '#343d46'; ctx.fill();
      ctx.restore();
    };
    const barrelText = (x) => {
      ctx.save();
      ctx.translate(x, 0);
      if (Math.cos(pen.angle) < -.05) ctx.rotate(Math.PI);
      ctx.font = '800 ' + Math.max(4.6, Math.min(6.4, hw * .95)) + 'px "Nunito Sans", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,250,235,.85)';
      ctx.fillText(p.mark, 0, .4);
      ctx.restore();
    };

    if (p.design === 'ball') {
      // Click ball pen: rear click button, cap band, ink window, steel ball tip.
      ctx.save();
      ctx.fillStyle = darker;
      rr(ctx, -hl - 5.5, -hw * .42, 7, hw * .84, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(35,32,25,.45)'; ctx.lineWidth = .6; ctx.stroke();
      barrel(); ctx.clip();
      ctx.fillStyle = dark; ctx.fillRect(-hl, -hw, len * .24, hw * 2);
      ctx.fillStyle = 'rgba(255,252,238,.55)';
      rr(ctx, -hl + len * .48, -hw * .5, len * .24, hw, hw * .5); ctx.fill();
      ctx.fillStyle = '#263f5c';
      rr(ctx, -hl + len * .51, -hw * .17, len * .18, Math.max(1.4, hw * .34), 1); ctx.fill();
      ctx.restore();
      clip(-hl + len * .07, len * .24, darker);
      barrelText(-hl * .42);
      ballTip();
    } else if (p.design === 'fountain') {
      // Fountain pen: posted cap, gold band + clip, dark section, split gold nib.
      ctx.save(); barrel(); ctx.clip();
      ctx.fillStyle = dark; ctx.fillRect(-hl - 1, -hw - 1, len * .29, hw * 2 + 2);
      ctx.fillStyle = '#d4a641'; ctx.fillRect(-hl + len * .285, -hw, 3.2, hw * 2);
      ctx.restore();
      clip(-hl + len * .05, len * .19, '#c99a35');
      barrelText(-hl * .02);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hl - 19, -hw * .88); ctx.lineTo(hl - 5, -hw * .66);
      ctx.lineTo(hl - 5, hw * .66); ctx.lineTo(hl - 19, hw * .88);
      ctx.closePath();
      ctx.fillStyle = '#2d3138'; ctx.fill();
      ctx.strokeStyle = 'rgba(20,22,26,.6)'; ctx.lineWidth = .6; ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hl - 7, -hw * .72);
      ctx.bezierCurveTo(hl + 1, -hw * .7, hl + 7, -hw * .33, hl + 13, 0);
      ctx.bezierCurveTo(hl + 7, hw * .33, hl + 1, hw * .7, hl - 7, hw * .72);
      ctx.bezierCurveTo(hl - 3.4, hw * .28, hl - 3.4, -hw * .28, hl - 7, -hw * .72);
      ctx.closePath();
      ctx.fillStyle = '#dcb04c'; ctx.fill();
      ctx.strokeStyle = 'rgba(91,64,20,.8)'; ctx.lineWidth = .7; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hl - 1, 0); ctx.lineTo(hl + 10.4, 0);
      ctx.strokeStyle = 'rgba(74,51,15,.85)'; ctx.lineWidth = .85; ctx.stroke();
      ctx.beginPath(); ctx.arc(hl + .4, 0, 1.15, 0, TAU);
      ctx.fillStyle = '#6d4c16'; ctx.fill();
      ctx.restore();
    } else {
      // Gel grip pen: posted cap, translucent barrel + refill, grooved rubber grip.
      ctx.save(); barrel(); ctx.clip();
      ctx.fillStyle = dark; ctx.fillRect(-hl - 1, -hw - 1, len * .25, hw * 2 + 2);
      ctx.fillStyle = 'rgba(255,252,235,.4)'; ctx.fillRect(-hl + len * .25, -hw, len * .46, hw * 2);
      ctx.fillStyle = '#263f5c';
      rr(ctx, -hl + len * .28, -hw * .2, len * .54, Math.max(2, hw * .4), 1.2); ctx.fill();
      ctx.restore();
      clip(-hl + len * .05, len * .16, darker);
      barrelText(-hl + len * .12);
      ctx.save();
      rr(ctx, hl - 31, -hw, 24, hw * 2, rad);
      ctx.fillStyle = '#47534e'; ctx.fill();
      ctx.strokeStyle = 'rgba(244,239,216,.55)'; ctx.lineWidth = .65;
      for (let i = 0; i < 4; i++) {
        const x = hl - 27 + i * 4.4;
        ctx.beginPath(); ctx.moveTo(x, -hw + 1.6); ctx.lineTo(x, hw - 1.6); ctx.stroke();
      }
      ctx.restore();
      ballTip();
    }
    ctx.restore();
  }

  function drawTrail(pen) {
    if (!pen.trail.length || pen.out) return;
    pen.trail.forEach((s, i) => {
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(s.angle);
      ctx.globalAlpha = (i + 1) / pen.trail.length * .11;
      ctx.fillStyle = pen.color;
      rr(ctx, -pen.halfLength, -pen.halfWidth, pen.profile.length, pen.profile.width, pen.halfWidth);
      ctx.fill();
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawStartMarks() {
    if (state.started) return;
    START.forEach((s, i) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = .5;
      ctx.strokeStyle = state.colors[i]; ctx.lineWidth = 1.3; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.ellipse(0, 0, 38, 96, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    });
  }

  function drawActiveHint(time) {
    if (!state.started || state.phase !== 'aim' || state.over) return;
    const pen = state.pens[state.turn];
    if (!pen || pen.out) return;
    ctx.save();
    ctx.translate(pen.x, pen.y); ctx.rotate(pen.angle);
    ctx.globalAlpha = .75;
    ctx.strokeStyle = state.colors[state.turn]; ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 6]); ctx.lineDashOffset = -time * .02;
    rr(ctx, -pen.halfLength - 11, -pen.halfWidth - 11, pen.profile.length + 22, pen.profile.width + 22, pen.halfWidth + 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(time) {
    if (!state.started || state.phase !== 'aim' || state.over) return;
    let angle = null, power = 0, ai = false;
    if (state.aim && state.aim.active) { angle = state.aim.angle; power = state.aim.power; }
    else if (isAiTurn() && state.aiPlan) { angle = state.aiPlan.angle; power = state.aiPlan.power; ai = true; }
    else return;
    const pen = state.pens[state.turn];
    if (!pen) return;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const sx = pen.x + dx * 30, sy = pen.y + dy * 30;
    const len = 60 + power * 360;
    const ex = sx + dx * len, ey = sy + dy * len;
    const col = ai ? '#e8b83e' : powerColor(power);
    ctx.save();
    if (!ai) {
      const bx = pen.x - dx * (24 + power * 66), by = pen.y - dy * (24 + power * 66);
      ctx.globalAlpha = .45; ctx.strokeStyle = '#fff2d1'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(pen.x, pen.y); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff2d1'; ctx.beginPath(); ctx.arc(bx, by, 1.5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = .95; ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.setLineDash([9, 8]); ctx.lineDashOffset = -time * .02;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ex + dx * 12, ey + dy * 12);
    ctx.lineTo(ex - dy * 6 - dx * 3, ey + dx * 6 - dy * 3);
    ctx.lineTo(ex + dy * 6 - dx * 3, ey - dx * 6 - dy * 3);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .7; ctx.lineWidth = 1.3; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(ex, ey, 9, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = '800 11px "Nunito Sans", sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(40,30,15,.55)';
    const label = Math.round(power * 100) + '%';
    ctx.strokeText(label, sx + 7, sy - 9);
    ctx.fillStyle = '#fff7e5'; ctx.fillText(label, sx + 7, sy - 9);
    if (ai) {
      ctx.font = '13px "Patrick Hand", cursive';
      ctx.strokeText('lining it up…', sx + 7, sy + 22);
      ctx.fillStyle = '#ffe59a'; ctx.fillText('lining it up…', sx + 7, sy + 22);
    }
    ctx.restore();
  }

  function drawPenTags() {
    for (const pen of state.pens) {
      if (pen.out) continue;
      const text = pen.index === 0 ? 'P1' : (state.mode === 'ai' ? 'CPU' : 'P2');
      const extentY = Math.abs(Math.sin(pen.angle)) * pen.halfLength + Math.abs(Math.cos(pen.angle)) * pen.halfWidth;
      const x = pen.x;
      const y = Math.max(TABLE.y + 12, pen.y - extentY - 13);
      ctx.save();
      ctx.font = '800 8px "Nunito Sans", sans-serif';
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(255,249,236,.94)';
      rr(ctx, x - w / 2, y - 8, w, 15, 6); ctx.fill();
      ctx.strokeStyle = state.colors[pen.index]; ctx.globalAlpha = .65; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = state.colors[pen.index];
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  }

  function render(time) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.fillStyle = '#25463e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    if (state.shake > .1) ctx.translate((Math.random() - .5) * state.shake, (Math.random() - .5) * state.shake);
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
    drawStartMarks();
    drawActiveHint(time);
    for (const pen of state.pens) drawTrail(pen);
    for (const pen of state.pens) drawPen(pen);
    drawEffects();
    drawAim(time);
    drawPenTags();
  }

  /* ---------------- DOM ---------------- */
  const dom = {
    setupPanel: $('setupPanel'), livePanel: $('livePanel'), sidebar: $('sidebar'),
    modeGroup: $('modeGroup'), difficultyWrap: $('difficultyWrap'), difficultyGroup: $('difficultyGroup'),
    seriesGroup: $('seriesGroup'), penOptions: $('penOptions'), colorSwatches: $('colorSwatches'),
    penFeature: $('penFeature'), colorLabel: $('colorLabel'),
    p1Tab: $('p1Tab'), p2Tab: $('p2Tab'), p1TabLabel: $('p1TabLabel'), p2TabLabel: $('p2TabLabel'),
    p2TabNum: $('p2TabNum'), p1TabSwatch: $('p1TabSwatch'), p2TabSwatch: $('p2TabSwatch'),
    startMatchBtn: $('startMatchBtn'), targetWinsLabel: $('targetWinsLabel'), seriesNote: $('seriesNote'),
    canvasNote: $('canvasNote'), headerStartBtn: $('headerStartBtn'), headerStartLabel: $('headerStartLabel'),
    headingSeries: $('headingSeries'), headingMode: $('headingMode'),
    soundBtn: $('soundBtn'), rulesBtn: $('rulesBtn'),
    rulesModal: $('rulesModal'), gameOverModal: $('gameOverModal'),
    roundOverlay: $('roundOverlay'), resultKicker: $('resultKicker'), resultTitle: $('resultTitle'),
    resultDesc: $('resultDesc'), resultScoreline: $('resultScoreline'), nextRoundBtn: $('nextRoundBtn'),
    toast: $('toast'), turnChip: $('turnChip'), turnDot: $('turnDot'), turnText: $('turnText'),
    thinkingDots: $('thinkingDots'), score1: $('score1'), score2: $('score2'),
    roundClock: $('roundClock'), seriesBadge: $('seriesBadge'), tableSub: $('tableSub'),
    canvasModeLabel: $('canvasModeLabel'),
    liveMode: $('liveMode'), liveCard1: $('liveCard1'), liveCard2: $('liveCard2'),
    liveS1: $('liveS1'), liveS2: $('liveS2'), liveName1: $('liveName1'), liveName2: $('liveName2'),
    liveProfile1: $('liveProfile1'), liveProfile2: $('liveProfile2'),
    liveScore1: $('liveScore1'), liveScore2: $('liveScore2'),
    liveTag1: $('liveTag1'), liveTag2: $('liveTag2'),
    pips1: $('pips1'), pips2: $('p2-pips') || $('pips2'), liveRound: $('liveRound'), liveSeriesLabel: $('liveSeriesLabel'),
    roundPips: $('roundPips'), liveRestartBtn: $('liveRestartBtn'), changePensBtn: $('changePensBtn'),
    hintTitle: $('hintTitle'), hintSub: $('hintSub'), beacon: $('beacon'),
    powerFill: $('powerFill'), powerRead: $('powerRead'),
    goTitle: $('goTitle'), goDesc: $('goDesc'), goKicker: $('goKicker'), goPenWrap: $('goPenWrap'),
    finalName1: $('finalName1'), finalName2: $('finalName2'),
    finalPen1: $('finalPen1'), finalPen2: $('finalPen2'),
    finalScore1: $('finalScore1'), finalScore2: $('finalScore2'),
    finalDot1: $('finalDot1'), finalDot2: $('finalDot2'), finalTarget: $('finalTarget'),
    goRounds: $('goRounds'), goClacks: $('goClacks'), goFalls: $('goFalls'),
    confettiLayer: $('confettiLayer'), playAgainBtn: $('playAgainBtn'), changePensAfterBtn: $('changePensAfterBtn'),
    boardColumn: $('boardColumn')
  };
  dom.pips2 = $('pips2');

  let lastPowerShown = -1;
  function setPower(p) {
    const pct = Math.round(clamp(p, 0, 1) * 100);
    if (pct === lastPowerShown) return;
    lastPowerShown = pct;
    dom.powerFill.style.width = pct + '%';
    dom.powerFill.style.background = powerColor(p);
    dom.powerRead.textContent = pct + '%';
    dom.powerRead.classList.toggle('is-hot', pct >= 78);
  }
  function showToast(msg, dur = 2000) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => dom.toast.classList.remove('show'), dur);
  }
  function updateClock(force) {
    const s = Math.floor(state.roundElapsed);
    if (!force && s === state.lastClock) return;
    state.lastClock = s;
    dom.roundClock.textContent = formatClock(s);
  }

  function buildSwatches() {
    dom.colorSwatches.innerHTML = '';
    for (const c of PEN_COLORS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.color = c.hex;
      b.style.setProperty('--swatch', c.hex);
      b.setAttribute('aria-label', c.name); b.title = c.name;
      dom.colorSwatches.appendChild(b);
    }
  }

  function updateSetupUI() {
    $$('[data-mode]', dom.modeGroup).forEach(b => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    dom.difficultyWrap.classList.toggle('hidden', state.mode !== 'ai');
    $$('[data-difficulty]', dom.difficultyGroup).forEach(b => b.classList.toggle('active', b.dataset.difficulty === state.difficulty));
    $$('[data-series]', dom.seriesGroup).forEach(b => b.classList.toggle('active', Number(b.dataset.series) === state.series));

    dom.p1Tab.classList.toggle('active', state.editingPlayer === 0);
    dom.p2Tab.classList.toggle('active', state.editingPlayer === 1);
    dom.p1Tab.setAttribute('aria-pressed', String(state.editingPlayer === 0));
    dom.p2Tab.setAttribute('aria-pressed', String(state.editingPlayer === 1));
    dom.p1TabSwatch.style.setProperty('--subject-color', state.colors[0]);
    dom.p2TabSwatch.style.setProperty('--subject-color', state.colors[1]);
    dom.p1TabLabel.textContent = state.mode === 'ai' ? 'You' : 'Player 1';
    dom.p2TabLabel.textContent = state.mode === 'ai' ? 'Computer' : 'Player 2';
    dom.p2TabNum.textContent = state.mode === 'ai' ? 'AI' : 'P2';
    dom.colorLabel.textContent = 'Pen colour · ' + (state.editingPlayer === 0 ? 'P1' : state.mode === 'ai' ? 'CPU' : 'P2');

    const editColor = state.colors[state.editingPlayer];
    $$('.pen-option', dom.penOptions).forEach(b => {
      const prof = PROFILES[b.dataset.profile];
      const on = b.dataset.profile === state.choices[state.editingPlayer];
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.style.setProperty('--pen', editColor);
      if (prof) {
        b.title = prof.feature;
        b.setAttribute('aria-label', prof.name + '. ' + prof.feature);
      }
    });
    const sel = PROFILES[state.choices[state.editingPlayer]];
    dom.penFeature.textContent = sel.feature;
    $$('.swatch', dom.colorSwatches).forEach(b => {
      const on = b.dataset.color === editColor;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });

    dom.targetWinsLabel.textContent = String(targetWins());
    dom.seriesNote.textContent = targetWins() === 2 ? 'first to two wins' : 'first to three wins';
    dom.headingSeries.textContent = 'best of ' + state.series + ' — first to ' + targetWins();
    dom.seriesBadge.textContent = 'Best of ' + state.series;
    dom.headingMode.textContent = state.mode === 'ai' ? 'solo vs computer · ' + state.difficulty : 'the classic desk duel';
    dom.liveSeriesLabel.textContent = 'of ' + state.series;
  }

  function buildPips(el, wins) {
    el.innerHTML = '';
    for (let i = 0; i < targetWins(); i++) {
      const pip = document.createElement('i');
      if (i < wins) pip.className = 'filled';
      el.appendChild(pip);
    }
  }

  function updateLivePanel() {
    const p1 = PROFILES[state.choices[0]], p2 = PROFILES[state.choices[1]];
    dom.liveName1.textContent = displayName(0);
    dom.liveName2.textContent = displayName(1);
    dom.liveProfile1.textContent = p1.name + ' · ' + p1.desc;
    dom.liveProfile2.textContent = p2.name + ' · ' + p2.desc;
    dom.liveProfile1.title = p1.feature;
    dom.liveProfile2.title = p2.feature;
    dom.liveScore1.textContent = String(state.scores[0]);
    dom.liveScore2.textContent = String(state.scores[1]);
    dom.liveS1.textContent = '1';
    dom.liveS2.textContent = state.mode === 'ai' ? 'C' : '2';
    dom.liveCard1.style.setProperty('--subject-color', state.colors[0]);
    dom.liveCard2.style.setProperty('--subject-color', state.colors[1]);
    dom.liveS1.style.background = state.colors[0];
    dom.liveS2.style.background = state.colors[1];
    buildPips(dom.pips1, state.scores[0]);
    buildPips(dom.pips2, state.scores[1]);

    const playing = state.started && !state.over && state.phase !== 'roundOver' && state.phase !== 'gameOver';
    dom.liveCard1.classList.toggle('is-active', playing && state.turn === 0);
    dom.liveCard2.classList.toggle('is-active', playing && state.turn === 1);
    if (!state.started) { dom.liveTag1.textContent = 'ready'; dom.liveTag2.textContent = 'ready'; }
    else if (state.phase === 'moving') {
      dom.liveTag1.textContent = state.turn === 0 ? 'shot away' : 'waiting';
      dom.liveTag2.textContent = state.turn === 1 ? 'shot away' : 'waiting';
    } else if (state.phase === 'roundOver' || state.phase === 'gameOver') {
      dom.liveTag1.textContent = state.roundResult && state.roundResult.winner === 0 ? 'round' : '—';
      dom.liveTag2.textContent = state.roundResult && state.roundResult.winner === 1 ? 'round' : '—';
    } else {
      dom.liveTag1.textContent = state.turn === 0 ? 'to shoot' : 'waiting';
      dom.liveTag2.textContent = state.turn === 1 ? (isAiTurn() ? 'thinking' : 'to shoot') : 'waiting';
    }

    dom.liveRound.textContent = String(state.round);
    dom.roundPips.innerHTML = '';
    const slots = Math.max(state.series, state.roundHistory.length);
    for (let i = 0; i < slots; i++) {
      const m = document.createElement('i');
      const r = state.roundHistory[i];
      if (r === 0 || r === 1) { m.className = r === 0 ? 'p1' : 'p2'; m.textContent = String(r + 1); }
      else if (r === 'draw') { m.className = 'draw'; m.textContent = '–'; }
      else m.textContent = '·';
      dom.roundPips.appendChild(m);
    }
    dom.liveMode.innerHTML = state.mode === 'ai'
      ? 'vs computer · <b>' + state.difficulty + ' mode</b>'
      : 'pass &amp; play · <b>local duel</b>';
  }

  function updateHud() {
    const col = state.colors[state.turn] || state.colors[0];
    dom.turnChip.style.setProperty('--turn-color', col);
    dom.beacon.style.setProperty('--turn-color', col);
    dom.beacon.style.background = col;
    dom.beacon.textContent = state.turn === 0 ? '1' : '2';
    dom.turnDot.textContent = state.turn === 0 ? '1' : '2';
    dom.turnDot.style.background = col;
    dom.score1.textContent = String(state.scores[0]);
    dom.score2.textContent = String(state.scores[1]);
    dom.seriesBadge.textContent = 'Best of ' + state.series;
    const thinking = state.started && state.phase === 'aim' && isAiTurn() && !state.paused;
    dom.turnChip.classList.toggle('is-thinking', thinking);
    dom.thinkingDots.classList.toggle('hidden', !thinking);
    canvas.classList.toggle('is-locked', !state.started || state.phase !== 'aim' || isAiTurn());
    dom.canvasNote.classList.toggle('hidden', state.started);

    if (!state.started) {
      dom.turnText.textContent = 'Table ready';
      dom.hintTitle.textContent = 'Your desk is ready.';
      dom.hintSub.textContent = 'Pick your pens in match setup, then start.';
      dom.tableSub.textContent = 'ready for a rematch';
      dom.canvasModeLabel.textContent = 'Table 03 · preview';
    } else if (state.phase === 'aim' && isAiTurn()) {
      dom.turnText.textContent = 'Computer thinking';
      dom.hintTitle.textContent = 'Computer is lining up…';
      dom.hintSub.textContent = state.difficulty === 'hard' ? 'Hard mode. It checks the edges twice.'
        : state.difficulty === 'medium' ? 'Medium mode. It found the middle of your pen.'
        : 'Easy mode. It has a plan. Sort of.';
      dom.tableSub.textContent = 'vs computer · round ' + state.round;
      dom.canvasModeLabel.textContent = 'Table 03 · ' + state.difficulty;
    } else if (state.phase === 'aim') {
      const name = displayName(state.turn);
      dom.turnText.textContent = state.mode === 'ai' ? 'Your turn' : name + ' to shoot';
      dom.hintTitle.textContent = state.mode === 'ai' ? 'Your turn. Make it count.' : name + ', take your shot.';
      dom.hintSub.textContent = 'Drag back from your pen, then release to flick.';
      dom.tableSub.textContent = (state.mode === 'ai' ? 'vs computer' : 'pass & play') + ' · round ' + state.round;
      dom.canvasModeLabel.textContent = 'Table 03 · ' + (state.mode === 'ai' ? 'vs CPU' : 'local');
    } else if (state.phase === 'moving') {
      dom.turnText.textContent = 'Pens in motion';
      dom.hintTitle.textContent = 'Easy there — still sliding.';
      dom.hintSub.textContent = 'The next turn unlocks when both pens stop.';
      dom.tableSub.textContent = 'round ' + state.round + ' · in play';
      dom.canvasModeLabel.textContent = 'Table 03 · in play';
    } else {
      dom.turnText.textContent = state.matchOver || state.phase === 'gameOver' ? 'Match complete' : 'Round complete';
      dom.hintTitle.textContent = state.matchOver || state.phase === 'gameOver' ? 'The desk has decided.' : 'That round is in the books.';
      dom.hintSub.textContent = state.matchOver || state.phase === 'gameOver' ? 'Have a rematch — the desk is not tired.' : 'Rerack the pens when you are ready.';
      dom.tableSub.textContent = 'round ' + state.round + ' · complete';
      dom.canvasModeLabel.textContent = 'Table 03 · result';
    }
    dom.headerStartLabel.textContent = state.started ? 'New match' : 'Start a duel';
    dom.headerStartBtn.setAttribute('aria-label', state.started ? 'Start a new match' : 'Start the match');
    updateLivePanel();
  }

  function refreshPreviewPens() {
    if (state.started) return;
    state.pens = [makePen(0), makePen(1)];
    state.turn = 0; state.phase = 'setup';
    state.aim = null; state.aiPlan = null;
    state.roundElapsed = 0;
    setPower(0); updateClock(true); updateHud();
  }

  /* ---------------- match flow ---------------- */
  function resetRound(announce = false) {
    sound.slideStop();
    clearTimeout(state.toastTimer);
    dom.toast.classList.remove('show');
    dom.roundOverlay.classList.add('hidden');
    effects.sparks = []; effects.dust = []; effects.waves = [];
    state.pens = [makePen(0), makePen(1)];
    state.turn = (state.round - 1) % 2;
    state.currentShooter = state.turn;
    state.phase = 'aim';
    state.aim = null; state.aiPlan = null; state.aiDeadline = 0;
    state.over = false; state.paused = false; state.matchOver = false;
    state.roundResult = null; state.resultIsDraw = false;
    state.roundElapsed = 0; state.shotElapsed = 0; state.physicsTime = 0;
    state.settleTimer = 0; state.accumulator = 0; state.shotTouched = false;
    state.lastClock = -1; state.shake = 0;
    setPower(0); updateClock(true); updateHud();
    if (announce) showToast('Round ' + state.round + ' · ' + displayName(state.turn) + ' breaks.', 2100);
  }

  function startMatch() {
    sound.init();
    closeGameOver();
    dom.roundOverlay.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.started = true; state.over = false; state.paused = false;
    state.round = 1; state.scores = [0, 0]; state.roundHistory = [];
    state.hitCount = 0; state.fallCount = 0; state.elapsed = 0;
    dom.setupPanel.classList.add('hidden');
    dom.livePanel.classList.remove('hidden');
    resetRound(false);
    showToast('Round 1 · ' + displayName(0) + ' breaks. Good luck.', 2300);
    sound.roundWin();
    updateSetupUI(); updateHud();
    if (window.matchMedia('(max-width: 1024px)').matches)
      setTimeout(() => dom.boardColumn.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function returnToSetup() {
    sound.slideStop();
    clearTimeout(state.toastTimer);
    dom.toast.classList.remove('show');
    closeRules(false); closeGameOver();
    document.body.classList.remove('modal-open');
    state.started = false; state.over = false; state.paused = false;
    state.phase = 'setup'; state.round = 1;
    state.scores = [0, 0]; state.roundHistory = [];
    state.hitCount = 0; state.fallCount = 0;
    state.aiPlan = null; state.aiDeadline = 0; state.aim = null;
    dom.setupPanel.classList.remove('hidden');
    dom.livePanel.classList.add('hidden');
    dom.roundOverlay.classList.add('hidden');
    state.pens = [makePen(0), makePen(1)];
    state.turn = 0; state.roundElapsed = 0;
    lastPowerShown = -1; setPower(0); updateClock(true);
    updateSetupUI(); updateHud();
    if (window.matchMedia('(max-width: 1024px)').matches)
      setTimeout(() => dom.setupPanel.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  const allPensStopped = () => state.pens.every(p => p.out || (speedOf(p) < 8 && Math.abs(p.omega) < .07));

  function processEvents(events, nowMs) {
    if (events.impacts.length) {
      state.shotTouched = true;
      const strongest = events.impacts.reduce((b, i) => i.impact > b.impact ? i : b, events.impacts[0]);
      if (strongest.impact > 35) {
        if (nowMs - state.lastClackAt > 70) { sound.clack(clamp(strongest.impact / 550, .15, 1)); state.lastClackAt = nowMs; }
        state.shake = Math.max(state.shake, clamp(strongest.impact / 220, .5, 6));
        spawnSparks(strongest.x, strongest.y, strongest.impact, state.pens[0], state.pens[1]);
        if (strongest.impact > 110 && nowMs - state.lastHitAt > 160) { state.hitCount++; state.lastHitAt = nowMs; }
      }
    }
    events.falls.forEach((pen, i) => {
      state.fallCount++;
      spawnDust(clamp(pen.x, TABLE.x + 10, TABLE_RIGHT - 10), clamp(pen.y, TABLE.y + 10, TABLE_BOTTOM - 10));
      if (i === 0) {
        sound.fall(); state.shake = 6;
        const f = displayName(pen.index);
        showToast((f === 'You' ? 'Your pen' : f + "'s pen") + ' just left the desk.', 1800);
      }
    });
  }

  function startShot(playerIndex, angle, power) {
    if (!state.started || state.over || state.paused || state.phase !== 'aim') return;
    if (playerIndex !== state.turn) return;
    const pen = state.pens[playerIndex];
    if (!pen || pen.out) return;
    sound.init(); sound.whoosh(); sound.slideStart();
    launchBody(pen, angle, power);
    pen.trail = [];
    state.currentShooter = playerIndex;
    state.phase = 'moving';
    state.aim = null; state.aiPlan = null; state.aiDeadline = 0;
    state.shotElapsed = 0; state.physicsTime = 0;
    state.settleTimer = 0; state.accumulator = 0; state.shotTouched = false; state.trailAt = 0;
    setPower(0); updateHud();
    if (state.mode === 'ai' && playerIndex === 1) showToast('Computer flicks. Watch the angles.', 1400);
  }

  function finalizeShot() {
    if (!state.started || state.phase !== 'moving') return;
    state.phase = 'checking';
    sound.slideStop();
    const shooter = state.currentShooter;
    const [p1, p2] = state.pens;
    if (p1.out || p2.out) {
      if (p1.out && p2.out) {
        if (Math.abs(p1.outAt - p2.outAt) < .08) {
          awardRound(-1, 'Both pens hit the floor together. No points, no blame — rerack and settle it.', true);
        } else {
          const winner = p1.outAt < p2.outAt ? 0 : 1;
          awardRound(winner, possessive(displayName(1 - winner)) + ' pen fell last, and the last one down loses. House rules.', false);
        }
      } else {
        const winner = p1.out ? 1 : 0;
        const loser = 1 - winner;
        const loserName = displayName(loser);
        const foul = shooter === loser && !state.shotTouched;
        awardRound(winner, foul
          ? 'No contact and straight off the wood — that is a foul. ' + (loserName === 'You' ? 'You lose the round.' : loserName + ' loses the round.')
          : shooter === loser
            ? 'A bold flick, then a long slide to the edge. ' + loserName + ' went over.'
            : possessive(loserName) + ' pen was nudged clean off the wood.', false);
      }
      return;
    }
    const missed = !state.shotTouched;
    switchTurn();
    if (missed) showToast('No contact. Still legal — the turn passes.', 1500);
  }

  function awardRound(winner, description, isDraw) {
    state.resultIsDraw = !!isDraw;
    if (isDraw) {
      state.roundHistory.push('draw');
      state.roundResult = { winner: -1 };
      state.phase = 'roundOver'; state.matchOver = false;
      sound.tone(330, 270, .18, .06);
    } else {
      state.scores[winner]++;
      state.roundHistory.push(winner);
      state.roundResult = { winner };
      state.phase = 'roundOver';
      state.matchOver = state.scores[winner] >= targetWins();
      sound.roundWin();
    }
    updateHud();
    showRoundResult(winner, description, !!isDraw);
  }

  function showRoundResult(winner, description, isDraw) {
    dom.resultKicker.textContent = 'Round ' + String(state.round).padStart(2, '0') + ' · ' + (isDraw ? 'double fall' : 'out of bounds');
    if (isDraw) dom.resultTitle.innerHTML = 'Double fall. <span class="accent">Rerack.</span>';
    else if (state.mode === 'ai' && winner === 0) dom.resultTitle.innerHTML = 'You take <span class="accent">the round.</span>';
    else if (state.mode === 'ai' && winner === 1) dom.resultTitle.innerHTML = 'Computer takes <span class="accent">the round.</span>';
    else dom.resultTitle.textContent = displayName(winner) + ' takes the round.';
    dom.resultDesc.textContent = description;
    dom.resultScoreline.innerHTML = displayName(0) + ' <b>' + state.scores[0] + '</b> <span>—</span> <b>' + state.scores[1] + '</b> ' + displayName(1);
    dom.nextRoundBtn.innerHTML = (isDraw ? 'Rerack the desk' : state.matchOver ? 'See the final result' : 'Next round') +
      ' <span class="arrow-disc" aria-hidden="true"><svg class="icon" style="width:12px;height:12px" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></span>';
    dom.roundOverlay.classList.remove('hidden');
    setTimeout(() => { try { dom.nextRoundBtn.focus({ preventScroll: true }); } catch (e) {} }, 120);
  }

  function switchTurn() {
    state.turn = 1 - state.turn;
    state.currentShooter = state.turn;
    state.phase = 'aim';
    state.aim = null; state.aiPlan = null; state.aiDeadline = 0;
    state.shotElapsed = 0; state.settleTimer = 0; state.accumulator = 0; state.shotTouched = false;
    for (const p of state.pens) p.trail = [];
    setPower(0); updateHud();
  }

  function nextRound() {
    if (!state.started || state.phase !== 'roundOver') return;
    if (state.matchOver) { showGameOver(); return; }
    sound.click();
    if (!state.resultIsDraw) state.round++;
    resetRound(true);
  }

  function makeConfetti() {
    dom.confettiLayer.innerHTML = '';
    const colors = ['#d6533a', '#e9ae32', '#4c9475', '#337cae', '#e2843d', '#7a5ba6'];
    for (let i = 0; i < 20; i++) {
      const c = document.createElement('i');
      c.style.left = (4 + Math.random() * 92) + '%';
      c.style.width = (3 + Math.random() * 4) + 'px';
      c.style.height = (7 + Math.random() * 7) + 'px';
      c.style.setProperty('--c', colors[i % colors.length]);
      c.style.setProperty('--d', (Math.random() * 1.8).toFixed(2) + 's');
      c.style.setProperty('--dx', Math.round(Math.random() * 80 - 40) + 'px');
      c.style.setProperty('--r', Math.round(Math.random() * 90 - 45) + 'deg');
      dom.confettiLayer.appendChild(c);
    }
  }

  function showGameOver() {
    if (!state.started) return;
    const winner = state.roundResult && state.roundResult.winner >= 0 ? state.roundResult.winner : (state.scores[0] > state.scores[1] ? 0 : 1);
    state.phase = 'gameOver'; state.over = true; state.paused = false;
    dom.roundOverlay.classList.add('hidden');
    makeConfetti();
    dom.goPenWrap.style.setProperty('--pen', state.colors[winner]);
    dom.finalName1.textContent = displayName(0);
    dom.finalName2.textContent = displayName(1);
    dom.finalPen1.textContent = PROFILES[state.choices[0]].alias;
    dom.finalPen2.textContent = PROFILES[state.choices[1]].alias;
    dom.finalScore1.textContent = String(state.scores[0]);
    dom.finalScore2.textContent = String(state.scores[1]);
    dom.finalDot1.style.setProperty('--c', state.colors[0]);
    dom.finalDot2.style.setProperty('--c', state.colors[1]);
    dom.finalTarget.textContent = String(targetWins());
    dom.goRounds.textContent = String(state.roundHistory.length);
    dom.goClacks.textContent = String(state.hitCount);
    dom.goFalls.textContent = String(state.fallCount);
    dom.goKicker.textContent = 'The final bell · round ' + state.round;
    if (state.mode === 'ai' && winner === 0) {
      dom.goTitle.innerHTML = 'You <em>win.</em>';
      dom.goDesc.textContent = state.scores[1] === 0
        ? 'A clean sweep. The computer is quietly recalculating its life choices.'
        : 'The machine had angles. You had audacity. That was enough today.';
    } else if (state.mode === 'ai' && winner === 1) {
      dom.goTitle.innerHTML = 'Computer <em>wins.</em>';
      dom.goDesc.textContent = 'The bot found the edge more often than you did. Rematch while it is feeling generous.';
    } else {
      dom.goTitle.innerHTML = displayName(winner) + ' <em>wins.</em>';
      dom.goDesc.textContent = displayName(1 - winner) + ' owes ' + displayName(winner) + ' a samosa and a new pen. House rules.';
    }
    dom.gameOverModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    updateHud();
    if (state.mode === 'ai' && winner === 1) sound.defeat(); else sound.victory();
    setTimeout(() => { try { dom.playAgainBtn.focus({ preventScroll: true }); } catch (e) {} }, 140);
  }
  function closeGameOver() {
    dom.gameOverModal.classList.add('hidden');
    if (dom.rulesModal.classList.contains('hidden')) document.body.classList.remove('modal-open');
  }
  function openRules() {
    sound.init();
    if (state.started && !state.over) { state.paused = true; state.pausedAt = performance.now(); }
    dom.rulesModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
  function closeRules(click = true) {
    if (dom.rulesModal.classList.contains('hidden')) return;
    dom.rulesModal.classList.add('hidden');
    if (state.paused) {
      const pausedFor = performance.now() - state.pausedAt;
      if (state.aiDeadline) state.aiDeadline += pausedFor;
      state.paused = false;
    }
    if (dom.gameOverModal.classList.contains('hidden')) document.body.classList.remove('modal-open');
    if (click) sound.click();
  }

  /* ---------------- main loop ---------------- */
  let prevFrame = 0;
  function update(dt, now) {
    updateEffects(dt);
    state.shake *= Math.exp(-7 * dt);
    for (const pen of state.pens) if (pen.out) pen.fallProgress = Math.min(1, pen.fallProgress + dt * 1.4);
    if (!state.started || state.over || state.paused) { sound.slideLevel(0); return; }

    state.elapsed += dt;
    if (state.phase === 'aim' || state.phase === 'moving') { state.roundElapsed += dt; updateClock(); }

    if (state.phase === 'aim' && isAiTurn()) {
      if (!state.aiPlan) {
        state.aiPlan = computeAiPlan();
        state.aiDeadline = now + (state.difficulty === 'hard' ? 1450 : state.difficulty === 'medium' ? 1100 : 800);
        setPower(state.aiPlan.power);
        updateHud();
      } else if (now >= state.aiDeadline) {
        startShot(1, state.aiPlan.angle, clamp(state.aiPlan.power, .2, 1));
      }
    }

    if (state.phase !== 'moving') { sound.slideLevel(0); return; }

    state.shotElapsed += dt;
    if (now - state.trailAt > 18) {
      state.trailAt = now;
      for (const pen of state.pens) {
        if (!pen.out && speedOf(pen) > 150) {
          pen.trail.push({ x: pen.x, y: pen.y, angle: pen.angle });
          if (pen.trail.length > 8) pen.trail.shift();
        }
      }
    }
    const events = { impacts: [], falls: [] };
    state.accumulator = Math.min(state.accumulator + dt, .06);
    while (state.accumulator >= STEP) {
      state.physicsTime += STEP;
      stepPhysics(state.pens, STEP, state.physicsTime, events);
      state.accumulator -= STEP;
    }
    processEvents(events, now);
    const topSpeed = Math.max(state.pens[0] ? speedOf(state.pens[0]) : 0, state.pens[1] ? speedOf(state.pens[1]) : 0);
    sound.slideLevel(clamp(topSpeed / 1300, 0, 1));

    if (allPensStopped()) {
      state.settleTimer += dt;
      if (state.settleTimer >= .45) finalizeShot();
    } else state.settleTimer = 0;

    if (state.shotElapsed > 8 && state.phase === 'moving') {
      for (const pen of state.pens) if (!pen.out) { pen.vx = 0; pen.vy = 0; pen.omega = 0; }
      finalizeShot();
    }
  }
  function frame(time) {
    if (!prevFrame) prevFrame = time;
    const dt = clamp((time - prevFrame) / 1000, 0, .05);
    prevFrame = time;
    update(dt, time);
    render(time);
    requestAnimationFrame(frame);
  }

  /* ---------------- flick input ---------------- */
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / Math.max(1, r.width) * WORLD.w, y: (e.clientY - r.top) / Math.max(1, r.height) * WORLD.h };
  };
  const canHumanAim = () => state.started && !state.over && state.phase === 'aim' && !state.paused && !isAiTurn();
  function distanceToPen(point, pen) {
    const ax = Math.cos(pen.angle), ay = Math.sin(pen.angle);
    const t = clamp((point.x - pen.x) * ax + (point.y - pen.y) * ay, -pen.halfLength, pen.halfLength);
    return hypot(point.x - (pen.x + ax * t), point.y - (pen.y + ay * t));
  }
  function onPointerDown(e) {
    sound.init();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (state.aim && state.aim.active) return;
    if (!canHumanAim()) {
      if (!state.started) {
        showToast('Set up your pens, then hit Start the match.', 1700);
        if (window.matchMedia('(max-width: 1024px)').matches)
          dom.setupPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (state.phase === 'moving') showToast('Hold up — the pens are still sliding.', 1400);
      else if (isAiTurn()) showToast('Computer’s turn. Watch the angles.', 1400);
      return;
    }
    const pen = state.pens[state.turn];
    if (!pen) return;
    const point = toWorld(e);
    const grab = clamp(40 / Math.max(.2, canvas.clientWidth / WORLD.w), 46, 92);
    if (distanceToPen(point, pen) > grab) { showToast('Press right on your pen to load a flick.', 1500); return; }
    e.preventDefault();
    state.aim = { active: true, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, angle: pen.angle, power: 0, distance: 0 };
    setPower(0);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPointerMove(e) {
    if (!state.aim || !state.aim.active || e.pointerId !== state.aim.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - state.aim.startX, dy = e.clientY - state.aim.startY;
    const dist = hypot(dx, dy);
    state.aim.distance = dist;
    if (dist > 3) state.aim.angle = Math.atan2(-dy, -dx);
    const limit = clamp(canvas.clientWidth * .36, 95, 200);
    state.aim.power = clamp(dist / limit, 0, 1);
    setPower(state.aim.power);
  }
  function finishAim(e, cancelled) {
    if (!state.aim || !state.aim.active || (e && e.pointerId !== state.aim.pointerId)) return;
    const aim = state.aim;
    state.aim = null;
    if (e) { try { canvas.releasePointerCapture(e.pointerId); } catch (err) {} }
    if (cancelled) { setPower(0); updateHud(); return; }
    if (aim.power >= .06 && aim.distance > 8) startShot(state.turn, aim.angle, aim.power);
    else { setPower(0); showToast('Pull back a little further to load the flick.', 1400); updateHud(); }
  }

  /* ---------------- bindings ---------------- */
  dom.modeGroup.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    state.mode = b.dataset.mode;
    updateSetupUI(); refreshPreviewPens(); updateHud();
  });
  dom.difficultyGroup.addEventListener('click', (e) => {
    const b = e.target.closest('[data-difficulty]'); if (!b) return;
    state.difficulty = b.dataset.difficulty;
    updateSetupUI(); updateHud();
  });
  dom.seriesGroup.addEventListener('click', (e) => {
    const b = e.target.closest('[data-series]'); if (!b) return;
    state.series = Number(b.dataset.series) || 3;
    updateSetupUI(); updateHud();
  });
  [dom.p1Tab, dom.p2Tab].forEach(tab => tab.addEventListener('click', () => {
    state.editingPlayer = Number(tab.dataset.player);
    updateSetupUI();
  }));
  dom.penOptions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-profile]'); if (!b) return;
    state.choices[state.editingPlayer] = b.dataset.profile;
    updateSetupUI(); refreshPreviewPens();
  });
  dom.colorSwatches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    const me = state.editingPlayer, other = 1 - me;
    const old = state.colors[me];
    if (state.colors[other] === b.dataset.color) state.colors[other] = old; // keep the two pens distinguishable
    state.colors[me] = b.dataset.color;
    updateSetupUI(); refreshPreviewPens();
  });
  dom.startMatchBtn.addEventListener('click', startMatch);
  dom.liveRestartBtn.addEventListener('click', startMatch);
  dom.changePensBtn.addEventListener('click', returnToSetup);
  dom.nextRoundBtn.addEventListener('click', nextRound);
  dom.playAgainBtn.addEventListener('click', startMatch);
  dom.changePensAfterBtn.addEventListener('click', returnToSetup);
  dom.headerStartBtn.addEventListener('click', startMatch);
  [dom.rulesBtn].filter(Boolean).forEach(b => b.addEventListener('click', openRules));
  $$('[data-close-rules]', dom.rulesModal).forEach(b => b.addEventListener('click', () => closeRules(true)));
  dom.rulesModal.addEventListener('pointerdown', (e) => { if (e.target === dom.rulesModal) closeRules(true); });
  dom.soundBtn.addEventListener('click', () => {
    sound.init();
    sound.setMuted(!sound.muted);
    syncSoundUI();
    if (!sound.muted) sound.click();
  });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', (e) => finishAim(e, false));
  canvas.addEventListener('pointercancel', (e) => finishAim(e, true));
  canvas.addEventListener('lostpointercapture', (e) => { if (state.aim && state.aim.active) finishAim(e, true); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRules(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sound.slideLevel(0); });
  document.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) sound.click();
  }, true);
  window.addEventListener('resize', resizeCanvas);
  if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvasShell);

  function syncSoundUI() {
    dom.soundBtn.setAttribute('aria-pressed', String(sound.muted));
    dom.soundBtn.setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
    dom.soundBtn.title = sound.muted ? 'Unmute sound' : 'Mute sound';
    const on = dom.soundBtn.querySelector('.icon-sound-on');
    const off = dom.soundBtn.querySelector('.icon-sound-off');
    if (on) on.classList.toggle('hidden', sound.muted);
    if (off) off.classList.toggle('hidden', !sound.muted);
  }

  /* ---------------- boot ---------------- */
  // GitHub Pages can publish a repository at a sub-path, so derive absolute
  // canonical/social URLs from the deployed directory instead of guessing it.
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    const publicUrl = new URL('./', window.location.href).href;
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (canonical) canonical.href = publicUrl;
    if (ogUrl) ogUrl.content = publicUrl;
    if (ogImage) ogImage.content = new URL('logo.svg', publicUrl).href;
    if (twitterImage) twitterImage.content = new URL('logo.svg', publicUrl).href;
  }

  buildSwatches();
  updateSetupUI();
  refreshPreviewPens();
  syncSoundUI();
  setPower(0);
  resizeCanvas();
  buildBackground();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildBackground).catch(() => {});
  requestAnimationFrame(frame);

  // Progressive Web App: installable + offline shell
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
