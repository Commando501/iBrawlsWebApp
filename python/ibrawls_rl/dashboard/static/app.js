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

// Trend of the last third of a series: +1 rising, -1 falling, 0 roughly flat.
function trendOf(series) {
  if (!series || series.length < 4) return 0;
  const tail = series.slice(Math.floor(series.length * 0.66));
  const first = tail[0][1], last = tail[tail.length - 1][1];
  const rel = (last - first) / (Math.abs(first) + 1e-9);
  return rel > 0.05 ? 1 : rel < -0.05 ? -1 : 0;
}

// title = chart heading; goal = the range/trend you want (shown under the title);
// help = longer explanation surfaced on hover. advise(lastValue, series) returns
// {level: good|warn|bad, text} shown under the chart ONCE TRAINING FINISHES — a concrete
// "what to change next run" tip based on the final value. See the Guide tab for the full version.
const METRIC_INFO = {
  "rollout/ep_rew_mean": { title: "Episode reward", goal: "Trend up",
    help: "Average total reward per match. Watch the trend, not the absolute value (it scales with your reward weights).",
    advise: (v, s) => {
      const t = trendOf(s);
      if (t > 0) return { level: "good", text: "Still climbing — give it more run.total_steps; it hasn't converged." };
      if (t < 0) return { level: "warn", text: "Reward fell back — likely unstable. Lower ppo.learning_rate next run." };
      return { level: "warn", text: "Plateaued — converged. To push further raise ppo.entropy_coef (0.02–0.05) to re-explore, or harden with domain randomization ([randomize] enabled=true)." };
    } },
  "eval/win_rate": { title: "Win rate vs opponent", goal: "Want > 0.9 to advance a stage",
    help: "Fraction of grading matches won (0–1). 0.6 = undertrained. During a self-play stage it's still measured vs random.",
    advise: (v) => {
      if (v >= 0.9) return { level: "good", text: "Plateaued high — ready to advance: set this run's final_model.zip as the next stage's network.init_model and pick a harder opponent." };
      if (v >= 0.6) return { level: "warn", text: "Undertrained. Raise run.total_steps and keep training (warm-start from this model) until it plateaus > 0.9 before advancing." };
      if (v >= 0.2) return { level: "warn", text: "Weak. Add total_steps and raise reward.approach (0.05) and/or ppo.entropy_coef (0.02–0.05)." };
      return { level: "bad", text: "Barely winning. Drop to run.opponent=random, run.match_minutes=1, run.goal_target=1, reward.approach=0.05, then lengthen once it wins." };
    } },
  "eval/ep_return": { title: "Eval episode return", goal: "Rising, then high plateau",
    help: "Average reward in the dedicated grading matches — a cleaner signal than the rollout reward.",
    advise: (v, s) => {
      const t = trendOf(s);
      if (t >= 0) return null;
      return { level: "warn", text: "Eval return slipping — lower ppo.learning_rate for a steadier run." };
    } },
  "rollout/ep_len_mean": { title: "Episode length (ticks)", goal: "Falling = decisive wins",
    help: "Average match length. Stuck high means stalling or failing to close out matches.",
    advise: (v, s) => {
      const t = trendOf(s);
      if (t > 0) return { level: "warn", text: "Rounds getting longer — passive play. Combat: raise reward.kill, lower run.match_minutes / [combat] kill_min. Grifball: lower reward.possession/ball_progress, raise reward.goal_scored." };
      if (t < 0) return { level: "good", text: "Shortening — fights are getting decisive." };
      return null;
    } },
  "train/loss": { title: "Total loss", goal: "No clean target — jittery is fine",
    help: "Combined PPO objective. Not like a supervised loss; don't chase it." },
  "train/value_loss": { title: "Value loss", goal: "Gradually decreasing",
    help: "Error predicting future reward. Brief spikes when the reward scale shifts are normal." },
  "train/policy_gradient_loss": { title: "Policy loss", goal: "No clean trend expected",
    help: "PPO's surrogate objective; hovers near zero. Don't read it like an error metric." },
  "train/entropy_loss": { title: "Entropy (exploration)", goal: "Drift slowly from ≈ −6.5 toward 0",
    help: "How random the policy still is. Pinned at start = not committing; crashes to 0 early = stopped exploring too soon.",
    advise: (v) => {
      if (v <= -5.5) return { level: "warn", text: "Still near max randomness — the policy isn't committing. Raise reward.approach, lower run.match_minutes, or add run.total_steps." };
      if (v >= -0.5) return { level: "warn", text: "Exploration collapsed early — raise ppo.entropy_coef (0.02–0.05) next run." };
      return { level: "good", text: "Exploration tapering nicely — no change needed." };
    } },
  "train/explained_variance": { title: "Explained variance", goal: "Rising toward 1.0 (negative = bad)",
    help: "Can the value head predict match outcome? Negative means the predictor is failing — lower the learning rate.",
    advise: (v) => {
      if (v < 0) return { level: "bad", text: "Negative — value predictor is failing. Lower ppo.learning_rate (e.g. 1e-4) next run." };
      if (v < 0.5) return { level: "warn", text: "Low — give it more run.total_steps, or lower ppo.learning_rate if it's jumpy." };
      return { level: "good", text: "Healthy — the value head predicts outcomes well." };
    } },
  "train/approx_kl": { title: "Policy change (KL)", goal: "~0.005–0.03",
    help: "How much the brain moved this update. Much bigger = unstable; lower learning rate or clip range.",
    advise: (v) => {
      if (v > 0.03) return { level: "bad", text: "Updates too large/unstable — lower ppo.learning_rate or ppo.clip_range." };
      if (v < 0.002) return { level: "warn", text: "Barely changing — you could raise ppo.learning_rate to learn faster." };
      return { level: "good", text: "In the healthy band — no change needed." };
    } },
  "time/fps": { title: "Speed (steps/sec)", goal: "As high as your cores allow",
    help: "Environment throughput. CPU-bound on the sim; raise num_workers / parallel_matches to lift it." },
};
const METRIC_TITLES = Object.fromEntries(
  Object.entries(METRIC_INFO).map(([k, v]) => [k, v.title]));
const orderedKeys = (keys) => {
  const known = Object.keys(METRIC_TITLES).filter((k) => keys.includes(k));
  const extra = keys.filter((k) => !METRIC_TITLES[k]).sort();
  return [...known, ...extra];
};

// renders a grid of single-series charts (used by Train live view).
// opts.finished => show per-chart "what to change next run" advice based on final values.
function renderCharts(container, seriesByKey, opts = {}) {
  const keys = orderedKeys(Object.keys(seriesByKey));
  if (!keys.length) { container.innerHTML = '<p class="muted">No metrics recorded yet.</p>'; return; }
  container.innerHTML = "";
  if (opts.finished) {
    container.append(el("div", { class: "done-banner" },
      "Training finished — the tip under each chart says what to change for the next run."));
  }
  for (const key of keys) {
    const pts = seriesByKey[key];
    const last = pts.length ? pts[pts.length - 1][1] : null;
    const info = METRIC_INFO[key];
    const card = el("div", { class: "chart-card", "data-key": key, title: info ? info.help : "" },
      el("div", { class: "chart-title" }, (info && info.title) || key,
        el("span", { class: "chart-last" }, fmtNum(last))),
      info ? el("div", { class: "chart-goal" }, info.goal) : null,
      el("canvas"));
    const advice = opts.finished && info && info.advise && last != null ? info.advise(last, pts) : null;
    if (advice) card.append(el("div", { class: "chart-advice " + advice.level }, advice.text));
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
      renderCharts($("#liveCharts"), m.series || {}, { finished: !status.running && status.state === "finished" });
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
    const info = METRIC_INFO[key];
    const card = el("div", { class: "chart-card", "data-key": key, title: info ? info.help : "" },
      el("div", { class: "chart-title" }, (info && info.title) || key),
      info ? el("div", { class: "chart-goal" }, info.goal) : null, el("canvas"));
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
  const reco = el("div", { id: "evalReco", class: "eval-reco" });
  $("#evalResult").innerHTML = ""; $("#evalResult").append(bars, summary, reco);
  renderEvalAdvice(r);
}

const round = (v, d = 3) => { const p = Math.pow(10, d); return Math.round(v * p) / p; };
// Bump a run dir to the next version so a retrain doesn't overwrite the graded run.
function bumpDir(dir) {
  if (!dir) return "runs/run_v2";
  const m = dir.match(/_v(\d+)$/);
  return m ? dir.replace(/_v\d+$/, "_v" + (Number(m[1]) + 1)) : dir + "_v2";
}

// Concrete config edits to retrain, keyed off the grade + current config (cfg = {field: value}).
// Each item: {label (toml-style), field (dataclass field, null = advisory only), value, why}.
function evalAdvice(r, cfg) {
  const wr = r.win_rate || 0, draw = r.draw_rate || 0;
  const mode = r.mode || "grifball";
  const opp = r.opponent || "random";
  const model = r.model || "";
  const items = [];
  const set = (label, field, value, why) => items.push({ label, field, value, why });
  const note = (label, value, why) => items.push({ label, field: null, value, why });
  const moreSteps = () => Math.round((Number(cfg.total_steps) || 3000000) * 1.5);
  let headline;

  if (mode === "combat") {
    if (wr >= 0.9) {
      headline = { level: "good", text: "Strong combat generalist — harden it or raise the challenge." };
      set("[randomize] enabled", "randomize_enabled", true, "train across a band of balance settings");
      set("[randomize] pct", "randomize_pct", 0.15, "±15% jitter on mechanics");
      if (model) set("[network] init_model", "init_model", model, "continue from this brain (keep width/depth)");
      set("[logging] dir", "logdir", "runs/combat_v2_dr", "new folder so you can compare");
    } else if (wr >= 0.5) {
      headline = { level: "warn", text: "Decent but not dominant — keep training this brain." };
      if (model) set("[network] init_model", "init_model", model, "warm-start, don't restart from scratch");
      set("[run] total_steps", "total_steps", moreSteps(), "more experience (~×1.5)");
      set("[logging] dir", "logdir", bumpDir(cfg.logdir), "new folder");
    } else {
      headline = { level: "bad", text: "Weak in combat — strengthen the learning signal." };
      set("[reward] kill", "reward_kill", 0.2, "pay it more for fights");
      set("[reward] approach", "reward_approach", 0.05, "pull it toward enemies");
      note("[combat] world_sizes", "include a few 2s", "small (1v1) matches give a faster signal — edit by hand");
      set("[run] total_steps", "total_steps", moreSteps(), "more experience (~×1.5)");
    }
  } else {
    if (wr >= 0.9) {
      if (opp === "random") {
        headline = { level: "good", text: "Mastered random — advance to self-play." };
        set("[run] opponent", "opponent", "self", "next stage of the curriculum");
        if (model) set("[network] init_model", "init_model", model, "warm-start from this stage (keep width/depth)");
        set("[logging] dir", "logdir", "runs/s2_self", "own folder for the new stage");
      } else if (opp === "self") {
        headline = { level: "good", text: "Strong in self-play — take the final exam." };
        set("[run] opponent", "opponent", "heuristic", "the hard scripted bot");
        if (model) set("[network] init_model", "init_model", model, "warm-start from self-play");
        set("[logging] dir", "logdir", "runs/s3_heur", "own folder");
      } else {
        headline = { level: "good", text: "Beating the heuristic — tournament-ready. Harden it." };
        set("[randomize] enabled", "randomize_enabled", true, "survive live balance patches");
        set("[randomize] pct", "randomize_pct", 0.15, "±15% jitter");
        if (model) set("[network] init_model", "init_model", model, "continue from this brain");
        set("[logging] dir", "logdir", "runs/s4_dr", "own folder");
      }
    } else if (wr >= 0.6) {
      headline = { level: "warn", text: "Undertrained for this opponent — keep training the same stage." };
      if (model) set("[network] init_model", "init_model", model, "warm-start (continue), don't restart");
      set("[run] total_steps", "total_steps", moreSteps(), "more experience until win_rate plateaus > 0.9");
      set("[logging] dir", "logdir", bumpDir(cfg.logdir), "keep runs separate");
    } else if (wr >= 0.3) {
      if (opp === "heuristic") {
        headline = { level: "warn", text: "Heuristic is a near-shutout — expected. Build a stronger base first." };
        set("[run] opponent", "opponent", "self", "more self-play before the exam");
        if (model) set("[network] init_model", "init_model", model, "continue from here");
      } else {
        headline = { level: "warn", text: "Even / losing — more exploration and time." };
        set("[ppo] entropy_coef", "entropy_coef", 0.03, "keep exploring longer");
        set("[reward] approach", "reward_approach", 0.05, "stronger foothold toward the ball");
        set("[run] total_steps", "total_steps", moreSteps(), "more experience (~×1.5)");
        if (model) set("[network] init_model", "init_model", model, "continue from here");
      }
    } else {
      headline = { level: "bad", text: "Losing badly — drop to an easier setup and ramp up." };
      set("[run] opponent", "opponent", "random", "easiest opponent — start here");
      set("[run] match_minutes", "match_minutes", 1.0, "short, decisive matches → more episodes");
      set("[run] goal_target", "goal_target", 1, "first goal wins (fast resolution)");
      set("[reward] approach", "reward_approach", 0.05, "lead it to the ball/enemy");
    }
  }
  if (draw >= 0.3) {
    set("[run] match_minutes", "match_minutes", round(Math.max(1, (Number(cfg.match_minutes) || 6) * 0.6), 1),
      "many draws/timeouts — force matches to resolve");
    set("[reward] goal_scored", "reward_goal_scored", round((Number(cfg.reward_goal_scored) || 1) * 1.5, 3),
      "commit to scoring");
    set("[reward] possession", "reward_possession", round((Number(cfg.reward_possession) || 0.002) * 0.5, 4),
      "stop hoarding the ball");
  }

  // De-dup by field (a later branch + the draw overlay can target the same field): keep the last.
  const seen = {}, deduped = [];
  for (const it of items) {
    if (it.field && seen[it.field] != null) { deduped[seen[it.field]] = it; continue; }
    if (it.field) seen[it.field] = deduped.length;
    deduped.push(it);
  }
  return { headline, items: deduped };
}

async function renderEvalAdvice(r) {
  let cfg = {};
  try { cfg = (await api.get("/api/config")).values || {}; } catch {}
  const { headline, items } = evalAdvice(r, cfg);
  const applicable = items.filter((it) => it.field);

  const rows = items.map((it) => {
    let firstCell;
    if (it.field) {
      const cb = el("input", { type: "checkbox", "data-field": it.field });
      cb.checked = true; cb.dataset.value = JSON.stringify(it.value);
      firstCell = cb;
    } else {
      firstCell = el("span", { class: "muted tag" }, "manual");
    }
    return el("tr", {},
      el("td", {}, firstCell),
      el("td", {}, el("code", {}, it.label)),
      el("td", {}, el("code", {}, String(it.value))),
      el("td", { class: "muted" }, it.why));
  });
  const table = el("table", { class: "guide-table" },
    el("thead", {}, el("tr", {}, el("th", {}, "✓"), el("th", {}, "Setting"),
      el("th", {}, "Change to"), el("th", {}, "Why"))),
    el("tbody", {}, ...rows));

  const applyBtn = el("button", { class: "btn primary",
    onclick: (e) => applyEvalReco(e.currentTarget) }, "Apply selected to config");
  if (!applicable.length) applyBtn.disabled = true;

  const reco = $("#evalReco");
  reco.innerHTML = "";
  reco.append(
    el("h3", {}, "Next training — what to change",
      el("small", {}, " tick the rows you want, then Apply")),
    el("div", { class: "reco-headline " + headline.level }, headline.text),
    table,
    el("div", { class: "reco-actions" }, applyBtn,
      el("span", { class: "muted" }, "Writes config.toml and refreshes the Train tab → Settings.")));
}

async function applyEvalReco(btn) {
  const boxes = $$('#evalReco input[type=checkbox]:checked');
  if (!boxes.length) { flash(btn, "Nothing ticked", false); return; }
  // Merge onto the FULL current config (a partial POST would reset other fields to defaults).
  const cur = (await api.get("/api/config")).values || {};
  const merged = { ...cur };
  boxes.forEach((c) => { merged[c.dataset.field] = JSON.parse(c.dataset.value); });
  const res = await api.post("/api/config", { values: merged });
  flash(btn, res.ok ? `Applied ${boxes.length} ✓` : (res.error || "Error"), res.ok);
  if (res.ok) loadConfig();  // reflect the new values in the Train form
}

// ================= boot =================
loadConfig();
pollTrain();
window.addEventListener("resize", () => {
  if ($("#tab-runs").classList.contains("active")) renderRunComparison();
});
