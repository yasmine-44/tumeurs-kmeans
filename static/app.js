"use strict";
/* vert = bénin, violet = malin. Aucune dépendance : graphiques dessinés en canvas. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const INK = cssv("--ink"), MUTED = cssv("--muted"), LINE = cssv("--line"), LINE_SOFT = cssv("--line-soft");
const BENIN = cssv("--benin") || "#DDF36B", MALIN = cssv("--malin") || "#5b58b4";
const COLORS = [BENIN, MALIN];               // groupe 1 = le moins malin (vert), groupe 2 = le plus malin (violet)
const GREY = "#cdb68d";                      // couleur des tumeurs avant l'affectation K-means
const FONT = "12px 'Rubik', sans-serif";

const state = {
  all: [], selected: [], result: null, auto: null, frames: [], stepIndex: 0, playTimer: null,
  ran: false, mode: "place", draft: [[0, 0], [0, 0]], init: null, drag: -1, bounds: null, vp: null,
  newPoint: null, values: {}, offset: 0, pageSize: 12, hits: [], token: 0, cells: null,
};

/* ---------- utilitaires ---------- */
const nf = (v, d = 2) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmt = v => (Math.abs(v) >= 100 ? nf(v, 0) : Math.abs(v) >= 1 ? nf(v, 1) : nf(v, 3));
const pct = v => Math.round(v * 100) + " %";
const label = key => (state.all.find(f => f.key === key) || {}).label || key;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function api(url, body, method) {
  const opts = body !== undefined
    ? { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : method ? { method } : {};
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Erreur du serveur");
  return j;
}

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx, w, h };
}

function ticks(min, max, n = 6) {
  const raw = (max - min) / n || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* ---------- dessin d'un noyau : formes et couleurs des SVG (bénin = vert, malin = violet) ---------- */
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const irregularity = cpts => clamp(0.05 + cpts * 2.2, 0.05, 0.45);

const SHAPE_BENIN = { w: 67.76, h: 62.8, fill: "#ddf36b",
  path: new Path2D("M67.76,31.54c0,9.05-3.61,21.69-9.87,27.41-3.87,3.54-8.18,5.13-13.6,2.59-14.24-6.67-16.44.98-23.02,1.24-.34.01-.67.02-1,.02-3.5,0-6.21-.91-9.66-4.49C7.49,55.07,0,46.34,0,31.72v-.32C.09,17.86,18.2.54,35.23,0h1.48c10.02.27,27.59,10.99,30.65,26.83.27,1.39.4,2.99.4,4.71Z") };
const SHAPE_MALIN = { w: 72.42, h: 63.29, fill: "#6b5ddb",
  path: new Path2D("M47.77,62.01c-14.24-6.67-16.43.98-23.02,1.24-4,.16-7.57,0-10.66-4.48-2.69-3.9.43-11.38-6.11-16.35-2.99-2.27-7.37-4.51-7.85-8.45-1.69-13.83,13.98-12.44,21.01-19.91C25.97,7.68,29.38-2.27,40.19.47c5.08,1.29,6.7,7.08,8.72,11.45,4.1,9.95,21.97,2.14,23.46,14.41.5,4.08-2.91,7.25-5.67,9.63-9.39,8.08,2.11,16.65-5.33,23.46-3.87,3.54-8.18,5.13-13.6,2.59Z") };

/* r : rayon en pixels (la forme occupe un cercle de diamètre ≈ 2r) ; les autres paramètres sont gardés pour compatibilité */
function drawCell(ctx, x, y, r, irr, texture, malin, seed, alpha = 1) {
  const sh = malin ? SHAPE_MALIN : SHAPE_BENIN, rand = rng(seed + 1);
  const rot = (rand() - 0.5) * Math.PI * 2;      // rotation aléatoire : la forme reste identique
  const k = (2 * r * (malin ? 1.1 : 1)) / sh.w;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(k, k); ctx.translate(-sh.w / 2, -sh.h / 2);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round"; ctx.lineWidth = 2.2 / k; ctx.strokeStyle = "#fff"; ctx.stroke(sh.path);   // fin liseré blanc entre noyaux voisins
  ctx.fillStyle = sh.fill; ctx.fill(sh.path);
  ctx.restore();
}

/* ---------- page de garde : champ de microscope, du mélange au tri ---------- */
function relax(cells, R) {                      // on écarte les noyaux qui se chevauchent
  for (let it = 0; it < 38; it++) {
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, m = (a.r + b.r) * 0.8;
      if (d < m) { const k = (m - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
    for (const c of cells) {
      c.x += (c.hx - c.x) * 0.015; c.y += (c.hy - c.y) * 0.015;
      const d = Math.hypot(c.x, c.y), lim = R * 0.93 - c.r * 0.3;
      if (d > lim) { c.x *= lim / d; c.y *= lim / d; }
    }
  }
}

function layoutCells(rows, R) {
  const q = (a, p) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(p * (s.length - 1))]; };
  const xs = rows.map(r => r[6]), ys = rows.map(r => r[7]);
  const cx = (q(xs, .02) + q(xs, .98)) / 2, cy = (q(ys, .02) + q(ys, .98)) / 2;
  const hx = (q(xs, .98) - q(xs, .02)) / 2, hy = (q(ys, .98) - q(ys, .02)) / 2;
  const s = R / 370, rand = rng(2024);
  const cells = rows.map(r => {
    let x = (r[6] - cx) / hx * R * 0.78, y = -(r[7] - cy) / hy * R * 0.78;
    const d = Math.hypot(x, y), lim = R * 0.9;
    if (d > lim) { x *= lim / d; y *= lim / d; }
    return { id: r[0], malin: r[1], r: r[2] * s, irr: irregularity(r[4]), tex: r[5], x, y, hx: x, hy: y, delay: rand() };
  });
  relax(cells, R);                               // positions finales : rangées par ressemblance
  for (const c of cells) { c.gx = c.x; c.gy = c.y; }
  for (const c of cells) {                       // positions de départ : tirées au hasard dans le disque (mélangées)
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R * 0.88;
    c.hx = c.x = Math.cos(a) * d; c.hy = c.y = Math.sin(a) * d;
  }
  relax(cells, R);
  for (const c of cells) { c.sx = c.x; c.sy = c.y; }
  cells.order = cells.map((c, i) => i).sort((p, q2) => cells[p].r - cells[q2].r);   // les plus gros dessous
  return cells;
}

const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function drawFieldAt(t) {
  if (!state.cells) return;
  const { ctx, w, h } = setup($("#field"));
  const R = Math.min(w, h) / 2;
  if (!state.fieldLayout || state.fieldLayout.R !== Math.round(R)) state.fieldLayout = { R: Math.round(R), cells: layoutCells(state.cells.rows, R) };
  const cells = state.fieldLayout.cells;
  ctx.save(); ctx.translate(w / 2, h / 2);
  for (const i of cells.order) {
    const c = cells[i], e = ease(clamp((t - c.delay * 0.4) / 0.6, 0, 1));
    drawCell(ctx, c.sx + (c.gx - c.sx) * e, c.sy + (c.gy - c.sy) * e, c.r, c.irr, c.tex, c.malin === 1, c.id, 1);
  }
  ctx.restore();
}
const replayBtn = $("#field-replay");
if (replayBtn) replayBtn.addEventListener("click", playField);
function playField() {
  cancelAnimationFrame(state.fieldRaf);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.fieldT = 1; drawFieldAt(1); return;
  }
  const dur = 4500, t0 = performance.now();
  const tick = now => {
    const t = clamp((now - t0) / dur, 0, 1);
    state.fieldT = t; drawFieldAt(t);
    if (t < 1) state.fieldRaf = requestAnimationFrame(tick);
  };
  state.fieldT = 0; drawFieldAt(0);
  state.fieldRaf = requestAnimationFrame(tick);
}

function drawField() { drawFieldAt(state.fieldT == null ? 0 : state.fieldT); }

/* ---------- planche 1 : noyaux moyens ---------- */
function drawNuclei() {
  if (!state.all.length) return;
  const f = k => state.all.find(x => x.key === k);
  for (const [sel, field, malin] of [["#nuc-b", "mean_benin", false], ["#nuc-m", "mean_malin", true]]) {
    const { ctx, w, h } = setup($(sel));
    const k = w * 0.0185;
    drawCell(ctx, w / 2, h / 2, f("radius")[field] * k, irregularity(f("concave_points")[field]), f("texture")[field], malin, malin ? 77 : 12, 1);
  }
  const rows = [["radius", "Rayon"], ["area", "Aire"], ["concavity", "Concavité"], ["concave_points", "Points concaves"], ["texture", "Texture"]];
  $("#compare").innerHTML = `<thead><tr><th>Mesure moyenne</th><th>Bénin</th><th>Malin</th><th>Écart</th></tr></thead><tbody>` +
    rows.map(([k, l]) => { const ft = f(k); return `<tr><td>${l}</td><td class="b">${fmt(ft.mean_benin)}</td><td class="m">${fmt(ft.mean_malin)}</td><td class="x">× ${nf(ft.mean_malin / ft.mean_benin, 1)}</td></tr>`; }).join("") + "</tbody>";
}

/* ---------- planche 2 : choix des mesures ---------- */
function renderMeasures() {
  const items = [...state.all].sort((a, b) => b.effect_size - a.effect_size);
  const max = Math.max(...items.map(i => i.effect_size));
  $("#feature-list").innerHTML = items.map(f => {
    const on = state.selected.includes(f.key);
    return `<label class="mrow ${on ? "" : "off"}"><input type="checkbox" value="${f.key}" ${on ? "checked" : ""}>
      <span class="mname">${f.label}<small>${f.description}</small></span>
      <span class="mbar"><i style="width:${f.effect_size / max * 100}%"></i></span><span class="mval">d = ${nf(f.effect_size, 2)}</span></label>`;
  }).join("");
}

/* ---------- atelier : carte ACP (placement, puis lecture pas à pas) ---------- */
function computeBounds(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const dx = x1 - x0 || 1, dy = y1 - y0 || 1;
  state.bounds = { x0: x0 - dx * 0.08, x1: x1 + dx * 0.08, y0: y0 - dy * 0.1, y1: y1 + dy * 0.1 };
}

function viewport(canvas) {
  const { ctx, w, h } = setup(canvas);
  const b = state.bounds, pad = { l: 34, r: 12, t: 12, b: 26 };
  const vp = {
    ctx, w, h, pad,
    sx: x => pad.l + (x - b.x0) / (b.x1 - b.x0) * (w - pad.l - pad.r),
    sy: y => h - pad.b - (y - b.y0) / (b.y1 - b.y0) * (h - pad.t - pad.b),
    ix: px => b.x0 + (px - pad.l) / (w - pad.l - pad.r) * (b.x1 - b.x0),
    iy: py => b.y0 + (h - pad.b - py) / (h - pad.t - pad.b) * (b.y1 - b.y0),
  };
  return vp;
}

function drawGrid(vp, axes) {
  const { ctx, w, h, pad, sx, sy } = vp, b = state.bounds;
  ctx.lineWidth = 1; ctx.font = "10px 'Rubik', sans-serif";
  ctx.fillStyle = MUTED; ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (const t of ticks(b.x0, b.x1)) {
    ctx.strokeStyle = t === 0 ? "#14142b44" : LINE_SOFT;
    ctx.beginPath(); ctx.moveTo(sx(t), pad.t); ctx.lineTo(sx(t), h - pad.b); ctx.stroke();
    ctx.fillText(nf(t, 0), sx(t), h - pad.b + 5);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const t of ticks(b.y0, b.y1)) {
    ctx.strokeStyle = t === 0 ? "#14142b44" : LINE_SOFT;
    ctx.beginPath(); ctx.moveTo(pad.l, sy(t)); ctx.lineTo(w - pad.r, sy(t)); ctx.stroke();
    ctx.fillText(nf(t, 0), pad.l - 6, sy(t));
  }
  ctx.font = FONT;
}

function marker(ctx, x, y, kind, text, color) {
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2);
  if (kind === "solid") { ctx.fillStyle = INK; ctx.fill(); ctx.fillStyle = "#fff"; }
  else { ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = color || INK; ctx.stroke(); ctx.fillStyle = color || INK; }
  ctx.font = "600 13px 'Rubik', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5); ctx.font = FONT;
}

/* couleur de départ : toutes les tumeurs sont grises (aucun indice sur le diagnostic) */
function startColor() { return GREY; }

function drawStage() {
  if (!state.result || !state.bounds) return;
  const box = $("#stage").parentElement; if (box) box.classList.remove("loading");
  const vp = viewport($("#stage")); state.vp = vp;
  const { ctx, w, h, pad, sx, sy } = vp;
  drawGrid(vp);
  const pts = state.result.points;
  if (state.mode === "place") {
    const [c1, c2] = state.draft, dx = c2[0] - c1[0], dy = c2[1] - c1[1];
    if (Math.hypot(dx, dy) > 1e-6) {             // médiatrice : frontière exacte de la première affectation
      const m = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2], L = 400 / Math.hypot(dx, dy);
      const d = [-dy * L, dx * L], n = [dx * L, dy * L];
      const P = [[m[0] + d[0], m[1] + d[1]], [m[0] - d[0], m[1] - d[1]], [m[0] - d[0] + n[0], m[1] - d[1] + n[1]], [m[0] + d[0] + n[0], m[1] + d[1] + n[1]]];
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); ctx.clip();
      ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.closePath();
      ctx.fillStyle = "rgba(20,28,43,.055)"; ctx.fill();
      ctx.setLineDash([6, 5]); ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sx(P[0][0]), sy(P[0][1])); ctx.lineTo(sx(P[1][0]), sy(P[1][1])); ctx.stroke();
      ctx.restore(); ctx.setLineDash([]);
    }
    pts.forEach((p, i) => {                      // avant K-means : toutes les tumeurs sont grises
      ctx.globalAlpha = 0.72; ctx.fillStyle = startColor(i, pts.length);
      ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3.4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#14142b66"; ctx.lineWidth = 0.7; ctx.stroke();
    });
    ctx.globalAlpha = 1;
    marker(ctx, sx(c1[0]), sy(c1[1]), "solid", "1");
    marker(ctx, sx(c2[0]), sy(c2[1]), "ring", "2");
  } else {
    const frame = state.frames[state.stepIndex], labels = frame.labels;
    pts.forEach((p, i) => {
      ctx.globalAlpha = 0.85; ctx.fillStyle = labels ? COLORS[labels[i] % 2] : startColor(i, pts.length);
      ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3.4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#14142b66"; ctx.lineWidth = 0.7; ctx.stroke();
    });
    ctx.globalAlpha = 1;
    for (let c = 0; c < 2; c++) {                // trajectoire de chaque centre
      ctx.setLineDash([4, 4]); ctx.strokeStyle = c === 0 ? "#8ea000" : COLORS[c]; ctx.lineWidth = 2; ctx.beginPath();
      let first = true, last = null;
      for (let i = 0; i <= state.stepIndex; i++) {
        const q = state.frames[i].centroids[c];
        if (last && Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) < 1e-9) continue;
        first ? ctx.moveTo(sx(q[0]), sy(q[1])) : ctx.lineTo(sx(q[0]), sy(q[1])); first = false; last = q;
      }
      ctx.stroke(); ctx.setLineDash([]);
      const q = frame.centroids[c];
      marker(ctx, sx(q[0]), sy(q[1]), "ring", c === 0 ? "G1" : "G2", c === 0 ? "#8ea000" : COLORS[c]);
    }
  }
}

function syncInputs(skip) {
  state.draft.forEach((c, i) => ["x", "y"].forEach((a, j) => {
    const el = $(`#c${i}${a}`);
    if (el && el.id !== skip) el.value = nf(c[j], 2).replace(/\s/g, "").replace(",", ".");
  }));
}

function setDraft(i, x, y, skipId) {
  const b = state.bounds;
  state.draft[i] = [clamp(x, b.x0, b.x1), clamp(y, b.y0, b.y1)];
  syncInputs(skipId); drawStage();
}

function bindStage() {
  const canvas = $("#stage");
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const near = (px, py) => {
    if (state.mode !== "place" || !state.vp) return -1;
    let best = -1, bd = 24 * 24;
    state.draft.forEach((c, i) => { const d = (state.vp.sx(c[0]) - px) ** 2 + (state.vp.sy(c[1]) - py) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  canvas.addEventListener("pointerdown", e => {
    const [px, py] = pos(e), i = near(px, py);
    if (i >= 0) { state.drag = i; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; }
  });
  canvas.addEventListener("pointermove", e => {
    const [px, py] = pos(e);
    if (state.drag >= 0) setDraft(state.drag, state.vp.ix(px), state.vp.iy(py));
    else canvas.style.cursor = near(px, py) >= 0 ? "grab" : "default";
  });
  const end = () => { state.drag = -1; canvas.style.cursor = "default"; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  for (const i of [0, 1]) for (const a of ["x", "y"]) {
    $(`#c${i}${a}`).addEventListener("input", e => {
      const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
      const c = state.draft[i];
      setDraft(i, a === "x" ? v : c[0], a === "y" ? v : c[1], e.target.id);
    });
  }
  $$("[data-preset]").forEach(btn => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));
}

function quantile(points, axis, q) {
  const s = points.map(p => p[axis]).sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))];
}

function applyPreset(name) {
  const pts = state.result.points;
  if (name === "pp") state.draft = state.auto.steps.frames[0].centroids.map(c => [...c]);
  else if (name === "good") { const y = quantile(pts, 1, 0.5); state.draft = [[quantile(pts, 0, 0.1), y], [quantile(pts, 0, 0.9), y]]; }
  else if (name === "bad") { const x = quantile(pts, 0, 0.35), y = quantile(pts, 1, 0.5); state.draft = [[x - 0.3, y + 0.3], [x + 0.3, y - 0.3]]; }
  else {
    const i = Math.floor(Math.random() * pts.length); let j = Math.floor(Math.random() * pts.length);
    if (j === i) j = (j + 1) % pts.length;
    state.draft = [[pts[i][0], pts[i][1]], [pts[j][0], pts[j][1]]];
  }
  setDraft(0, state.draft[0][0], state.draft[0][1]); setDraft(1, state.draft[1][0], state.draft[1][1]);
}

/* ---------- atelier : lecture pas à pas ---------- */
const STEP_TEXT = {
  initialisation: ["Initialisation", () => state.init
    ? "Les deux centroïdes sont exactement là où tu les as posés. Les points sont gris : aucun n’est encore rangé dans un groupe."
    : "K-means++ choisit deux centres de départ éloignés l’un de l’autre. Les points sont gris : aucun n’est encore rangé dans un groupe."],
  affectation: ["Affectation", () => "Chaque tumeur prend la couleur du centroïde le plus proche (distance euclidienne, mesures standardisées) : les couleurs se corrigent."],
  recalcul: ["Recalcul des centres", () => "Chaque centroïde se déplace vers la moyenne des tumeurs de son groupe. La ligne pointillée montre son trajet."],
  convergence: ["Convergence", () => "Les centres ne bougent presque plus : l’algorithme s’arrête. Les couleurs vont du groupe le moins malin (vert) au plus malin (violet)."],
};

function stopPlay() {
  if (state.playTimer) clearInterval(state.playTimer);
  state.playTimer = null;
  $("#step-play").textContent = "▶ Lecture";
}

function renderRun() {
  const total = state.frames.length, i = state.stepIndex, f = state.frames[i];
  const [title, desc] = STEP_TEXT[f.phase];
  $("#step-kicker").textContent = f.phase === "initialisation" ? "Départ" : f.phase === "convergence" ? "Terminé" : `Itération ${f.iteration}`;
  $("#step-title").textContent = title;
  $("#step-desc").textContent = desc() + (f.phase === "recalcul" && f.shift != null ? ` Déplacement (au carré) : ${nf(f.shift, 4)}.` : "");
  $("#step-bar").style.width = `${total > 1 ? i / (total - 1) * 100 : 100}%`;
  $("#step-prev").disabled = i === 0; $("#step-next").disabled = i >= total - 1;
  const cnt = f.labels ? [0, 1].map(g => f.labels.filter(l => l === g).length) : null;
  $("#r-b").textContent = cnt ? cnt[0] : "–"; $("#r-m").textContent = cnt ? cnt[1] : "–";
  $("#step-count").textContent = `Instantané ${i + 1} sur ${total}`;
  $("#verdict").textContent = f.phase === "convergence" ? verdictText() : "";
  drawStage();
}

function verdictText() {
  const r = state.result, m = r.metrics, ref = r.reference_inertia;
  if (!r.custom) return "Départ automatique : K-means a essayé 10 départs et gardé le meilleur.";
  const rel = (m.inertia - ref) / ref;
  return rel < 0.002
    ? "Ton départ mène à la même solution que le départ automatique."
    : "Ton départ a donné un résultat moins bon que le départ automatique : K-means dépend de son point de départ.";
}

function moveStep(d) { stopPlay(); state.stepIndex = clamp(state.stepIndex + d, 0, state.frames.length - 1); renderRun(); }

function togglePlay() {
  if (state.playTimer) { stopPlay(); return; }
  if (state.stepIndex >= state.frames.length - 1) state.stepIndex = 0;
  $("#step-play").textContent = "❚❚ Pause"; renderRun();
  state.playTimer = setInterval(() => {
    if (state.stepIndex >= state.frames.length - 1) { stopPlay(); return; }
    state.stepIndex++; renderRun();
    if (state.stepIndex >= state.frames.length - 1) stopPlay();
  }, 950);
}

function renderStageChrome() {
  const place = state.mode === "place";
  $("#panel-place").hidden = !place; $("#panel-run").hidden = place;
  const pill = $("#stage-pill");
  pill.textContent = place ? "Étape 1 · Placer les centroïdes" : "Étape 2 · K-means en marche";
  pill.classList.toggle("run", !place);
  const r = state.result.pca.ratio;
  $("#stage-cap").textContent = `Plan ACP · axe 1 ${pct(r[0])}, axe 2 ${pct(r[1])} de la variance`;
  $("#stage-legend").innerHTML = place
    ? `<span><i class="swatch" style="background:${GREY}"></i>tumeurs pas encore classées (K-means ne connaît pas le diagnostic)</span><span>① ② centroïdes à placer</span>`
    : `<span><i class="swatch" style="background:${BENIN}"></i>groupe 1 (le moins malin)</span><span><i class="swatch" style="background:${MALIN}"></i>groupe 2 (le plus malin)</span><span>au départ : points gris, colorés à l’affectation</span>`;
  if (place) { syncInputs(); drawStage(); } else renderRun();
}

async function runFrom(init) {
  if (state.selected.length < 2) return;
  stopPlay();
  const status = $("#stage-status"); status.textContent = "K-means calcule…";
  $("#launch").disabled = true;
  const token = ++state.token;
  try {
    let res, steps;
    if (init) {
      const body = { features: state.selected, init_centers: init.map(c => [+c[0].toFixed(3), +c[1].toFixed(3)]) };
      [res, steps] = await Promise.all([api("/api/cluster", body), api("/api/steps", body)]);
    } else { res = state.auto.res; steps = state.auto.steps; }
    if (token !== state.token) return;
    applyRun(res, steps, init ? body_init(init) : null);
    status.textContent = "";
  } catch (err) { status.textContent = err.message; }
  $("#launch").disabled = false;
}
const body_init = init => init.map(c => [+c[0].toFixed(3), +c[1].toFixed(3)]);

function showResults(on) {
  $("#results-lock").hidden = on; $("#results-body").hidden = !on;
  $("#tester-lock").hidden = on; $("#tester-body").hidden = !on;
}

function applyRun(res, steps, init) {
  state.result = res; state.init = init; state.frames = steps.frames; state.stepIndex = 0;
  state.mode = "run"; state.newPoint = null; state.ran = true;
  $("#predict-result").hidden = true;
  renderStageChrome(); showResults(true); renderResults();   // les résultats n'apparaissent qu'après un lancement
}

/* ---------- résultats : rond = bénin, étoile = malin ---------- */
function drawScatter() {
  const r = state.result; if (!r) return;
  const vp = viewport($("#scatter")); const { ctx, sx, sy } = vp;
  drawGrid(vp);
  state.hits = [];
  for (const p of r.points) {
    const x = sx(p[0]), y = sy(p[1]);
    ctx.globalAlpha = 0.85; ctx.fillStyle = COLORS[p[2] % 2];
    ctx.beginPath();
    if (p[3] === 1) {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 3.4 : 7.5;
        k ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    } else ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = "#14142b88"; ctx.lineWidth = 0.8; ctx.stroke();
    state.hits.push({ x, y, p });
  }
  r.centroids.forEach((c, i) => marker(ctx, sx(c[0]), sy(c[1]), "ring", `G${i + 1}`, i === 0 ? "#8ea000" : COLORS[i % 2]));
  if (state.newPoint) {
    const x = sx(state.newPoint[0]), y = sy(state.newPoint[1]);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const rad = i % 2 ? 6 : 14, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = INK; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
}

function bindScatterHover() {
  const canvas = $("#scatter"), tip = $("#tip");
  canvas.addEventListener("mousemove", e => {
    const b = canvas.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
    let best = null, bd = 100;
    for (const hit of state.hits) { const d = (hit.x - mx) ** 2 + (hit.y - my) ** 2; if (d < bd) { bd = d; best = hit; } }
    if (!best) { tip.hidden = true; return; }
    const [, , g, malin, id] = best.p;
    tip.textContent = `Tumeur n°${id} · ${malin ? "maligne" : "bénigne"} · groupe ${g + 1}`;
    tip.style.left = best.x + "px"; tip.style.top = best.y + "px"; tip.hidden = false;
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; });
}

function renderResults() {
  const r = state.result;
  $("#legend").innerHTML = r.clusters.map(c =>
    `<span><i class="swatch" style="background:${COLORS[c.id % 2]}"></i>Groupe ${c.id + 1} : ${c.size} tumeurs, ${pct(c.pct_malin)} malignes</span>`).join("") +
    `<span>${r.custom ? "Départ : tes centroïdes" : "Départ : K-means++ automatique"}</span>`;
  renderPredictFields(); drawScatter();
}

/* ---------- formulaire de test ---------- */
function renderPredictFields() {
  $("#predict-fields").innerHTML = state.selected.map(key => {
    const f = state.all.find(x => x.key === key);
    const v = state.values[key] !== undefined ? state.values[key] : +f.mean.toPrecision(4);
    return `<label class="field" title="${f.description}">${f.label}<input type="number" step="any" min="0" name="${key}" value="${v}" required><small>de ${fmt(f.min)} à ${fmt(f.max)}</small></label>`;
  }).join("");
}

function fillProfile(field) {
  for (const key of state.selected) state.values[key] = +state.all.find(x => x.key === key)[field].toPrecision(4);
  renderPredictFields();
}

async function submitPredict(e) {
  e.preventDefault();
  const values = {};
  for (const key of state.selected) { values[key] = parseFloat($(`#predict-fields input[name="${key}"]`).value); state.values[key] = values[key]; }
  const box = $("#predict-result");
  try {
    const body = { features: state.selected, values };
    if (state.init) body.init_centers = state.init;
    const r = await api("/api/predict", body);
    state.newPoint = r.point; drawScatter();
    box.className = "result " + (r.cluster === 1 ? "m" : "b");
    box.innerHTML = `<p><strong>Groupe ${r.cluster + 1}</strong> (${r.cluster === 1 ? "violet" : "vert"}) : ${pct(r.pct_malin)} des ${r.size} tumeurs de ce groupe sont malignes.</p>
      <p class="hint">Distance aux centres (unités standardisées) : ${r.distances.map((d, i) => `groupe ${i + 1} = ${nf(d, 2)}`).join(", ")}. L’étoile noire marque l’échantillon sur la carte des résultats.</p>`;
  } catch (err) { box.className = "result error"; box.textContent = err.message; }
  box.hidden = false;
}

/* ---------- données brutes ---------- */
async function loadTable() {
  const r = await api(`/api/tumeurs?limit=${state.pageSize}&offset=${state.offset}`);
  $("#data-table").innerHTML = `<thead><tr><th>N°</th><th>Diagnostic</th>${state.all.map(c => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>` +
    r.rows.map(row => `<tr><td>${row.id}</td><td style="color:${row.diagnostic === "M" ? MALIN : "#6d7f00"};font-weight:600">${row.diagnostic === "M" ? "Malin" : "Bénin"}</td>${state.all.map(c => `<td>${fmt(row[c.key])}</td>`).join("")}</tr>`).join("") + "</tbody>";
  $("#page-info").textContent = `${state.offset + 1} à ${Math.min(state.offset + state.pageSize, r.total)} sur ${r.total}`;
  $("#prev").disabled = state.offset === 0; $("#next").disabled = state.offset + state.pageSize >= r.total;
}

/* ---------- recalcul quand les variables changent ---------- */
let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 220); };

async function refresh() {
  const status = $("#status");
  if (state.selected.length < 2) { status.textContent = "Coche au moins 2 mesures."; return; }
  status.textContent = "Calcul en cours…";
  const token = ++state.token;
  try {
    const body = { features: state.selected };
    const [res, steps] = await Promise.all([api("/api/cluster", body), api("/api/steps", body)]);
    if (token !== state.token) return;
    stopPlay();
    state.auto = { res, steps };
    state.result = res; state.init = null; state.newPoint = null; state.mode = "place"; state.ran = false;
    computeBounds(res.points);
    state.draft = steps.frames[0].centroids.map(c => [...c]);
    const pr = $("#predict-result"); if (pr) pr.hidden = true;
    status.textContent = `${state.selected.length} mesures utilisées · tout est à jour`;
    showResults(false); renderStageChrome();
  } catch (err) { status.textContent = err.message; }
}

function redrawAll() { drawField(); drawNuclei(); if (state.result) { drawStage(); if (state.ran) drawScatter(); } }

/* ---------- initialisation ---------- */
async function init() {
  const [feats, sum, cells] = await Promise.all([api("/api/features"), api("/api/summary"), api("/api/cells")]);
  state.all = feats; state.selected = feats.map(f => f.key); state.cells = cells;
  $("#n-benin").textContent = sum.n_benin; $("#n-malin").textContent = sum.n_malin;
  renderMeasures(); drawNuclei();
  $("#feature-list").addEventListener("change", () => {
    state.selected = $$("#feature-list input:checked").map(i => i.value);
    $$("#feature-list .mrow").forEach(r => r.classList.toggle("off", !r.querySelector("input").checked));
    schedule();
  });
  const setAll = on => { state.selected = on ? state.all.map(f => f.key) : []; renderMeasures(); schedule(); };
  $("#all-on").addEventListener("click", () => setAll(true));
  $("#all-off").addEventListener("click", () => setAll(false));
  $("#launch").addEventListener("click", () => runFrom(state.draft));
  $("#auto-run").addEventListener("click", () => runFrom(null));
  $("#edit-centroids").addEventListener("click", () => {
    stopPlay();
    if (state.init) state.draft = state.init.map(c => [...c]);
    else state.draft = state.auto.steps.frames[0].centroids.map(c => [...c]);
    state.mode = "place"; renderStageChrome();
  });
  $("#step-prev").addEventListener("click", () => moveStep(-1));
  $("#step-next").addEventListener("click", () => moveStep(1));
  $("#step-reset").addEventListener("click", () => { stopPlay(); state.stepIndex = 0; renderRun(); });
  $("#step-play").addEventListener("click", togglePlay);
  $("#predict-form").addEventListener("submit", submitPredict);
  $("#fill-benin").addEventListener("click", () => fillProfile("mean_benin"));
  $("#fill-malin").addEventListener("click", () => fillProfile("mean_malin"));
  $("#prev").addEventListener("click", () => { state.offset = Math.max(0, state.offset - state.pageSize); loadTable(); });
  $("#next").addEventListener("click", () => { state.offset += state.pageSize; loadTable(); });
  window.addEventListener("resize", () => { clearTimeout(init.rt); init.rt = setTimeout(redrawAll, 140); });
  bindStage(); bindScatterHover();
  playField();
  await Promise.all([refresh(), loadTable()]);
}

(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => init()).catch(err => {
  const s = $("#status"); if (s) s.textContent = "Impossible de charger les données : " + err.message;
  const b = $("#stage") && $("#stage").parentElement; if (b) b.classList.remove("loading");
});