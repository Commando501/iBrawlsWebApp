"use strict";

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const api = {
  async get(path) { const r = await fetch(path); return r.json(); },
  async post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    return r.json();
  },
};
const fmtInt = (n) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtDur = (s) => {
  if (s == null) return "—";
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};
const fmtNum = (v) => {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 1e5)) return v.toExponential(2);
  return (Math.round(v * 1000) / 1000).toString();
};

// ---------- tabs ----------
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".tabpane").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  $("#tab-" + t.dataset.tab).classList.add("active");
  if (t.dataset.tab === "runs") loadRuns();
  if (t.dataset.tab === "evaluate") loadModels();
}));

// ================= CONFIG FORM =================
let SCHEMA = null;

function knobInput(knob, value) {
  const v = value !== undefined ? value : knob.default;
  if (knob.type === "bool") {
    const cb = el("input", { type: "checkbox", "data-field": knob.field });
    cb.checked = !!v;
    return el("label", { class: "toggle" }, cb, el("span", { class: "slider" }));
  }
  if (knob.type === "choice") {
    const sel = el("select", { "data-field": knob.field });
    for (const opt of knob.choices) {
      const o = el("option", { value: opt }, opt);
      if (String(opt) === String(v)) o.selected = true;
      sel.append(o);
    }
    return sel;
  }
  if (knob.type === "intlist") {
    return el("input", { type: "text", "data-field": knob.field, "data-list": "1", value: Array.isArray(v) ? v.join(", ") : v });
  }
  if (knob.type === "int" || knob.type === "float") {
    const attrs = { type: "number", "data-field": knob.field, value: v };
    if (knob.min != null) attrs.min = knob.min;
    if (knob.max != null) attrs.max = knob.max;
    if (knob.step != null) attrs.step = knob.step;
    else attrs.step = knob.type === "int" ? 1 : "any";
    return el("input", attrs);
  }
  return el("input", { type: "text", "data-field": knob.field, value: v });
}

function buildForm(schema, values) {
  const root = $("#configForm");
  root.innerHTML = "";
  for (const section of schema.sections) {
    const body = el("div", { class: "fs-body" });
    for (const knob of section.knobs) {
      const row = el("div", { class: "knob-row" },
        el("label", {}, knob.label),
        knobInput(knob, values[knob.field]));
      const knobEl = el("div", { class: "knob" }, row);
      if (knob.description) knobEl.append(el("div", { class: "desc" }, knob.description));
      body.append(knobEl);
    }
    const legend = el("legend", {}, section.title, el("span", { class: "muted" }, "▾"));
    const fs = el("fieldset", { class: "fieldset" }, legend, body);
    legend.addEventListener("click", () => fs.classList.toggle("collapsed"));
    root.append(fs);
  }
}

function collectValues() {
  const values = {};
  $$("#configForm [data-field]").forEach((inp) => {
    const f = inp.dataset.field;
    if (inp.type === "checkbox") values[f] = inp.checked;
    else if (inp.dataset.list) values[f] = inp.value;
    else if (inp.type === "number") values[f] = inp.value === "" ? 0 : Number(inp.value);
    else values[f] = inp.value;
  });
  return values;
}

async function loadConfig() {
  const [schema, cfg] = await Promise.all([api.get("/api/schema"), api.get("/api/config")]);
  SCHEMA = schema;
  buildForm(schema, cfg.values || {});
}

$("#btnSave").addEventListener("click", async () => {
  const res = await api.post("/api/config", { values: collectValues() });
  flash($("#btnSave"), res.ok ? "Saved ✓" : "Error", res.ok);
});
$("#btnStart").addEventListener("click", async () => {
  const res = await api.post("/api/train/start", { values: collectValues() });
  if (!res.ok) flash($("#btnStart"), res.error || "Error", false);
  logCursor = 0; $("#console").textContent = "";
  pollTrain();
});
$("#btnStop").addEventListener("click", async () => { await api.post("/api/train/stop", {}); pollTrain(); });

function flash(btn, msg, ok) {
  const old = btn.textContent; btn.textContent = msg;
  btn.style.borderColor = ok ? "var(--good)" : "var(--bad)";
  setTimeout(() => { btn.textContent = old; btn.style.borderColor = ""; }, 1500);
}

// ================= CANVAS CHART =================
const PALETTE = ["#4f9dff", "#7c5cff", "#3fb950", "#d29922", "#f85149", "#36c5c5", "#e879f9", "#a3e635"];

function drawChart(canvas, series) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300, cssH = canvas.clientHeight || 150;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 48, padR = 10, padT = 8, padB = 20;
  const W = cssW - padL - padR, H = cssH - padT - padB;

  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (const [x, y] of s.points) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  if (!isFinite(xmin)) { ctx.fillStyle = "#566"; ctx.fillText("no data yet", padL, padT + H / 2); return; }
  if (xmax === xmin) xmax = xmin + 1;
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const padY = (ymax - ymin) * 0.08; ymin -= padY; ymax += padY;
  const sx = (x) => padL + ((x - xmin) / (xmax - xmin)) * W;
  const sy = (y) => padT + (1 - (y - ymin) / (ymax - ymin)) * H;

  // grid + y labels
  ctx.strokeStyle = "#222b36"; ctx.fillStyle = "#6b7686"; ctx.font = "10px system-ui"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yy = padT + (H * i) / 4, val = ymax - ((ymax - ymin) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + W, yy); ctx.stroke();
    ctx.fillText(fmtNum(val), 4, yy + 3);
  }
  // x labels (min/max)
  ctx.fillText(fmtInt(xmin), padL, padT + H + 14);
  ctx.textAlign = "right"; ctx.fillText(fmtInt(xmax), padL + W, padT + H + 14); ctx.textAlign = "left";

  series.forEach((s, i) => {
    ctx.strokeStyle = s.color || PALETTE[i % PALETTE.length];
    ctx.lineWidth = 1.8; ctx.beginPath();
    s.points.forEach(([x, y], j) => { const X = sx(x), Y = sy(y); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.stroke();
  });
}

const METRIC_TITLES = {
  "rollout/ep_rew_mean": "Episode reward (higher = better)",
  "eval/win_rate": "Win rate vs opponent (0–1)",
  "eval/ep_return": "Eval episode return",
  "rollout/ep_len_mean": "Episode length (ticks)",
  "train/loss": "Total loss",
  "train/value_loss": "Value loss",
  "train/policy_gradient_loss": "Policy loss",
  "train/entropy_loss": "Entropy (exploration)",
  "train/explained_variance": "Explained variance (→1 good)",
  "train/approx_kl": "Policy change (KL)",
  "time/fps": "Speed (steps/sec)",
};
const orderedKeys = (keys) => {
  const known = Object.keys(METRIC_TITLES).filter((k) => keys.includes(k));
  const extra = keys.filter((k) => !METRIC_TITLES[k]).sort();
  return [...known, ...extra];
};

// renders a grid of single-series charts (used by Train live view)
function renderCharts(container, seriesByKey, runLabel) {
  const keys = orderedKeys(Object.keys(seriesByKey));
  if (!keys.length) { container.innerHTML = '<p class="muted">No metrics recorded yet.</p>'; return; }
  // reuse existing canvases when possible to avoid flicker
  const have = {}; $$(".chart-card", container).forEach((c) => (have[c.dataset.key] = c));
  container.innerHTML = "";
  for (const key of keys) {
    const pts = seriesByKey[key];
    const last = pts.length ? pts[pts.length - 1][1] : null;
    const card = el("div", { class: "chart-card", "data-key": key },
      el("div", { class: "chart-title" }, METRIC_TITLES[key] || key,
        el("span", { class: "chart-last" }, fmtNum(last))),
      el("canvas"));
    container.append(card);
    drawChart($("canvas", card), [{ points: pts, color: PALETTE[0] }]);
  }
}

// ================= TRAIN POLLING =================
let logCursor = 0;
let trainTimer = null;

async function pollTrain() {
  let status;
  try { status = await api.get("/api/train/status"); } catch { return; }
  const badge = $("#stateBadge");
  badge.className = "badge " + status.state; badge.textContent = status.state;
  $("#btnStart").disabled = status.running;
  $("#btnStop").disabled = !status.running;
  $("#statStep").textContent = fmtInt(status.last_step);
  $("#statElapsed").textContent = fmtDur(status.elapsed);

  const pct = status.progress != null ? Math.round(status.progress * 100) : 0;
  $("#progressFill").style.width = pct + "%";
  $("#progressLabel").textContent = status.total_steps
    ? `${pct}%  (${fmtInt(status.last_step)} / ${fmtInt(status.total_steps)})` : "—";

  // logs
  try {
    const lg = await api.get("/api/train/log?since=" + logCursor);
    if (lg.lines && lg.lines.length) {
      const c = $("#console");
      const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 20;
      c.textContent += (c.textContent ? "\n" : "") + lg.lines.join("\n");
      logCursor = lg.next;
      if (atBottom) c.scrollTop = c.scrollHeight;
    }
  } catch {}

  // metrics + fps/eta
  const logdir = status.meta && status.meta.logdir;
  if (logdir) {
    try {
      const m = await api.get("/api/run/metrics?dir=" + encodeURIComponent(logdir));
      $("#liveSource").textContent = m.source === "tensorboard" ? "(from TensorBoard files)" : "";
      renderCharts($("#liveCharts"), m.series || {});
      const fps = m.series && m.series["time/fps"];
      const fpsVal = fps && fps.length ? fps[fps.length - 1][1] : null;
      $("#statFps").textContent = fpsVal ? fmtInt(fpsVal) : "—";
      if (fpsVal && status.total_steps && status.last_step != null) {
        const remain = (status.total_steps - status.last_step) / fpsVal;
        $("#statEta").textContent = remain > 0 ? fmtDur(remain) : "—";
      }
    } catch {}
  }

  // schedule next poll while running (or once more after finish)
  clearTimeout(trainTimer);
  if (status.running) trainTimer = setTimeout(pollTrain, 1500);
}

// ================= RUNS =================
let runColors = {};
async function loadRuns() {
  const data = await api.get("/api/runs");
  const list = $("#runsList"); list.innerHTML = "";
  if (!data.runs || !data.runs.length) { list.innerHTML = '<p class="muted">No runs yet. Train something!</p>'; return; }
  data.runs.forEach((r, i) => {
    const cb = el("input", { type: "checkbox", "data-run": r.rel });
    cb.addEventListener("change", renderRunComparison);
    const prog = r.total_steps && r.last_step != null
      ? Math.round((r.last_step / r.total_steps) * 100) + "%" : (r.last_step != null ? fmtInt(r.last_step) + " steps" : "");
    const sub = el("div", { class: "run-sub" },
      r.mode ? el("span", { class: "chip" }, r.mode) : null,
      r.opponent ? el("span", { class: "chip" }, "vs " + r.opponent) : null,
      r.has_final ? el("span", { class: "chip" }, "final") : null,
      el("span", { class: "chip" }, r.checkpoints + " ckpts"),
      prog ? el("span", {}, prog) : null);
    list.append(el("div", { class: "run-item" }, cb,
      el("div", { class: "run-meta" }, el("div", { class: "run-name" }, r.name), sub)));
  });
}
$("#btnRefreshRuns").addEventListener("click", loadRuns);

async function renderRunComparison() {
  const selected = $$('#runsList input[type=checkbox]:checked').map((c) => c.dataset.run);
  const container = $("#runCharts");
  if (!selected.length) { container.innerHTML = '<p class="muted">Select one or more runs on the left to chart them.</p>'; return; }
  const results = await Promise.all(selected.map((rel) =>
    api.get("/api/run/metrics?dir=" + encodeURIComponent(rel)).then((m) => ({ rel, m }))));
  // union of metric keys
  const allKeys = new Set();
  results.forEach(({ m }) => Object.keys(m.series || {}).forEach((k) => allKeys.add(k)));
  const keys = orderedKeys([...allKeys]);
  container.innerHTML = "";
  selected.forEach((rel, i) => (runColors[rel] = PALETTE[i % PALETTE.length]));
  for (const key of keys) {
    const series = results
      .filter(({ m }) => m.series && m.series[key])
      .map(({ rel, m }) => ({ label: rel, color: runColors[rel], points: m.series[key] }));
    if (!series.length) continue;
    const card = el("div", { class: "chart-card", "data-key": key },
      el("div", { class: "chart-title" }, METRIC_TITLES[key] || key), el("canvas"));
    const legend = el("div", { class: "chart-legend" });
    series.forEach((s) => legend.append(el("span", {}, el("i", { style: `background:${s.color}` }), s.label.replace("runs/", ""))));
    card.append(legend);
    container.append(card);
    drawChart($("canvas", card), series);
  }
}

// ================= EVALUATE =================
let evalTimer = null;
async function loadModels() {
  const data = await api.get("/api/models");
  const sel = $("#evalModel"); sel.innerHTML = "";
  if (!data.models || !data.models.length) { sel.append(el("option", { value: "" }, "— no models found —")); return; }
  data.models.forEach((m) => sel.append(el("option", { value: m.path, "data-mode": m.mode || "" }, m.label)));
  syncEvalMode();
}
$("#evalModel").addEventListener("change", syncEvalMode);
$("#evalMode").addEventListener("change", () => { $("#evalOppWrap").style.display = $("#evalMode").value === "combat" ? "none" : "flex"; });
function syncEvalMode() {
  const opt = $("#evalModel").selectedOptions[0];
  if (opt && opt.dataset.mode) $("#evalMode").value = opt.dataset.mode;
  $("#evalOppWrap").style.display = $("#evalMode").value === "combat" ? "none" : "flex";
}

$("#btnEval").addEventListener("click", async () => {
  const body = {
    model: $("#evalModel").value, mode: $("#evalMode").value,
    opponent: $("#evalOpponent").value, matches: Number($("#evalMatches").value),
    num_envs: Number($("#evalEnvs").value),
  };
  const res = await api.post("/api/eval/start", body);
  if (!res.ok) { $("#evalState").textContent = res.error || "error"; return; }
  $("#evalResult").innerHTML = ""; pollEval();
});
$("#btnEvalStop").addEventListener("click", async () => { await api.post("/api/eval/stop", {}); pollEval(); });

async function pollEval() {
  const st = await api.get("/api/eval/status");
  $("#btnEval").disabled = st.running; $("#btnEvalStop").disabled = !st.running;
  $("#evalState").textContent = st.running ? "running…" : st.state;
  $("#evalLog").textContent = (st.log || []).join("\n");
  $("#evalLog").scrollTop = $("#evalLog").scrollHeight;
  if (st.result) renderEvalResult(st.result);
  clearTimeout(evalTimer);
  if (st.running) evalTimer = setTimeout(pollEval, 1200);
}

function renderEvalResult(r) {
  const w = (r.win_rate || 0) * 100, l = (r.loss_rate || 0) * 100, d = (r.draw_rate || 0) * 100;
  const bars = el("div", { class: "bars" });
  if (w > 0) bars.append(el("div", { class: "bar win", style: `width:${w}%` }, w >= 8 ? Math.round(w) + "%" : ""));
  if (d > 0) bars.append(el("div", { class: "bar draw", style: `width:${d}%` }, d >= 8 ? Math.round(d) + "%" : ""));
  if (l > 0) bars.append(el("div", { class: "bar loss", style: `width:${l}%` }, l >= 8 ? Math.round(l) + "%" : ""));
  const summary = el("div", { class: "summary" },
    el("div", {}, el("span", { class: "big" }, Math.round(w) + "% wins"), " over " + fmtInt(r.episodes) + " matches"),
    el("div", { class: "muted" }, `win ${fmtNum(r.win_rate)} · draw ${fmtNum(r.draw_rate)} · loss ${fmtNum(r.loss_rate)}`
      + (r.ep_return != null ? ` · avg return ${fmtNum(r.ep_return)}` : "")));
  $("#evalResult").innerHTML = ""; $("#evalResult").append(bars, summary);
}

// ================= boot =================
loadConfig();
pollTrain();
window.addEventListener("resize", () => {
  if ($("#tab-runs").classList.contains("active")) renderRunComparison();
});
