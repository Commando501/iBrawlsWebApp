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
  if (t.dataset.tab === "evaluate") { loadModels(); loadEvalHistory(); }
  if (t.dataset.tab === "optimizer") loadOptimizer();
  if (t.dataset.tab === "watch") loadWatch();
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
  buildSweepKnobs();  // the Optimizer's knob dropdown shares the schema
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
  "reward_component/kill": { title: "Reward: kills", goal: "Positive when fights resolve",
    help: "Signed kill reward contribution aggregated by the sim for the latest PPO step." },
  "reward_component/approach": { title: "Reward: approach", goal: "Helpful early, not dominant late",
    help: "Signed approach shaping contribution. If this dominates, the bot may chase/circle instead of finishing." },
  "reward_component/timePenalty": { title: "Reward: time pressure", goal: "Small negative",
    help: "Signed stalling penalty contribution." },
  "reward_component/invalidAttack": { title: "Penalty: wasted attacks", goal: "Near 0",
    help: "Penalty from attack inputs while the weapon cannot fire." },
  "reward_component/invalidDash": { title: "Penalty: wasted dashes", goal: "Near 0",
    help: "Penalty from dash inputs while dash cannot fire." },
  "reward_component/invalidJump": { title: "Penalty: wasted jumps", goal: "Near 0",
    help: "Penalty from jump inputs while already airborne." },
  "reward_component/invalidSwap": { title: "Penalty: wasted swaps", goal: "Near 0",
    help: "Penalty from impossible weapon swaps." },
  "reward_component/actionRepeat": { title: "Penalty: repeated action", goal: "Near 0",
    help: "Penalty from repeating the exact same non-idle action decision." },
  "behavior/move_switch_rate": { title: "Twitchiness (move switches)", goal: "Human-like ≲ 0.3",
    help: "How often the move direction flips between decisions during eval. Humans hold a heading; ≳0.5 looks robotic-jittery.",
    advise: (v) => v > 0.5
      ? { level: "warn", text: "Very twitchy movement. A higher run.decision_interval and lower late-run entropy smooth this out." }
      : { level: "good", text: "Movement commitment looks human-plausible." } },
  "behavior/idle_frac": { title: "Idle fraction", goal: "Low but nonzero",
    help: "Fraction of eval decisions with no movement input. ~0 = relentless robot; high = passive." },
  "behavior/action_repeat_rate": { title: "Repeated actions", goal: "Lower is more varied",
    help: "Fraction of eval decisions exactly repeating the previous full action factor vector." },
  "behavior/aim_enemy_rate": { title: "Enemy aim usage", goal: "High in combat",
    help: "Fraction of eval decisions using the nearest-enemy aim factor." },
  "behavior/attack_rate": { title: "Attack rate", goal: "Context-dependent",
    help: "Fraction of eval decisions pressing an attack. 1.0 = button-mashing every decision (not human)." },
  "behavior/jump_rate": { title: "Jump rate", goal: "Context-dependent",
    help: "Fraction of eval decisions jumping. Constant bunny-hopping reads as robotic." },
  "behavior/dash_rate": { title: "Dash rate", goal: "Context-dependent",
    help: "Fraction of eval decisions dashing (cooldown-limited)." },
  "league/learner_win_rate": { title: "League win rate", goal: "~0.5–0.7 vs the snapshot pool",
    help: "Rolling win rate vs frozen past snapshots (PFSP league worlds). Hovering ≈0.5–0.7 = learning while the pool keeps up; pinned at 1.0 = the pool is stale (lower league.snapshot_every).",
    advise: (v) => {
      if (v >= 0.95) return { level: "warn", text: "Crushing the whole snapshot pool — opponents are stale. Lower league.snapshot_every so fresher selves join the pool." };
      if (v <= 0.25) return { level: "warn", text: "Losing to past snapshots — possible regression. Check approx_kl/learning rate." };
      return { level: "good", text: "Healthy league pressure — the pool is keeping the policy honest." };
    } },
  "league/pool_size": { title: "League pool size", goal: "Grows over the run",
    help: "Number of frozen snapshots in the opponent pool (seeds + auto-freezes)." },
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

// ================= SHARED: apply a {field: value} patch to config.toml =================
async function applyConfigPatch(patch, btn) {
  // Merge onto the FULL current config (a partial POST would reset other fields to defaults).
  const cur = (await api.get("/api/config")).values || {};
  const res = await api.post("/api/config", { values: { ...cur, ...patch } });
  if (btn) flash(btn, res.ok ? "Applied ✓" : (res.error || "Error"), res.ok);
  if (res.ok) {
    loadConfig();  // reflect the new values in the Train form
    pollAdvisor(advisorLastDir || "", true);  // re-lint with the new config
  }
  return res.ok;
}

// ================= ADVISOR =================
let advisorLastAt = 0;
let advisorLastDir;

async function pollAdvisor(dir, force = false) {
  const now = Date.now();
  if (!force && dir === advisorLastDir && now - advisorLastAt < 6000) return;
  advisorLastAt = now; advisorLastDir = dir;
  let out;
  try { out = await api.get("/api/advice" + (dir ? "?dir=" + encodeURIComponent(dir) : "")); }
  catch { return; }
  renderAdvisor(out, dir);
}

function renderAdvisor(out, dir) {
  const verdict = out.verdict || { level: "good", text: "" };
  const vWrap = $("#advisorVerdict");
  vWrap.innerHTML = "";
  vWrap.append(el("span", { class: "adv-verdict " + verdict.level },
    verdict.text + (dir ? `  ·  ${dir.replace("runs/", "")}` : "")));

  const body = $("#advisorBody");
  const findings = out.findings || [];
  if (!findings.length) {
    body.className = "advisor-body muted";
    body.textContent = "Nothing to flag — settings look sound for this machine.";
    return;
  }
  body.className = "advisor-body";
  body.innerHTML = "";
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  findings.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  for (const f of findings) {
    const card = el("div", { class: "adv-card " + f.level },
      el("div", { class: "adv-title" }, f.title),
      el("div", { class: "adv-detail" }, f.detail));
    const fixes = f.fixes || {};
    const keys = Object.keys(fixes);
    if (keys.length) {
      const row = el("div", { class: "adv-fixes" });
      keys.forEach((k) => row.append(el("code", {}, `${k} → ${JSON.stringify(fixes[k])}`)));
      row.append(el("button", {
        class: "btn tiny primary",
        onclick: (e) => applyConfigPatch(fixes, e.currentTarget),
      }, "Apply"));
      card.append(row);
    }
    body.append(card);
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

  // advisor: diagnose the active/last run, or just lint the config when idle
  pollAdvisor((status.meta && status.meta.logdir) || "");

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
$("#evalMode").addEventListener("change", syncEvalMode);
function syncEvalMode() {
  const opt = $("#evalModel").selectedOptions[0];
  if (opt && opt.dataset.mode) $("#evalMode").value = opt.dataset.mode;
  const combat = $("#evalMode").value === "combat";
  $("#evalOppWrap").style.display = combat ? "none" : "flex";
  $("#evalMatrixWrap").style.display = combat ? "flex" : "none";
  $("#evalLeagueWrap").style.display = combat ? "flex" : "none";
}

$("#btnEval").addEventListener("click", async () => {
  const body = {
    model: $("#evalModel").value, mode: $("#evalMode").value,
    opponent: $("#evalOpponent").value, matches: Number($("#evalMatches").value),
    num_envs: Number($("#evalEnvs").value), device: $("#evalDevice").value,
    frame_stack: Number($("#evalFrameStack").value),
    observation_version: Number($("#evalObservationVersion").value),
    matrix: $("#evalMatrix").checked,
    league_snapshots: $("#evalLeagueSnapshots").value.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean),
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

  // progress + ETA bar
  const bar = $("#evalProgress");
  if (st.running) {
    bar.style.display = "block";
    const pct = st.progress != null ? Math.round(st.progress * 100) : 0;
    $("#evalProgressFill").style.width = pct + "%";
    const count = st.total ? `${fmtInt(st.completed)} / ${fmtInt(st.total)} matches` : "starting…";
    const eta = st.eta != null ? `~${fmtDur(st.eta)} left`
      : (st.completed ? "estimating…" : "spinning up sim…");
    $("#evalProgressLabel").textContent = `${count}  ·  ${fmtDur(st.elapsed)} elapsed  ·  ${eta}`;
  } else {
    bar.style.display = "none";
  }

  $("#evalLog").textContent = (st.log || []).join("\n");
  $("#evalLog").scrollTop = $("#evalLog").scrollHeight;
  if (st.result) renderEvalResult(st.result);
  if (!st.running && st.result) loadEvalHistory();  // a grade just landed → refresh the log
  clearTimeout(evalTimer);
  if (st.running) evalTimer = setTimeout(pollEval, 1200);
}

// ================= EVAL HISTORY =================
let histSortBest = false;
async function loadEvalHistory() {
  let data;
  try { data = await api.get("/api/eval/history"); } catch { return; }
  renderEvalHistory(data.history || []);
}
function renderEvalHistory(history) {
  const root = $("#evalHistory");
  if (!history.length) { root.innerHTML = '<p class="muted">No evaluations yet — run one above and it\'ll show up here.</p>'; return; }
  const rows = history.slice();
  const histScore = promotionRankScore;
  if (histSortBest) rows.sort((a, b) => histScore(b) - histScore(a));
  const best = Math.max(...rows.map(histScore));
  const table = el("table", { class: "guide-table hist-table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "When"), el("th", {}, "Model"), el("th", {}, "Mode"),
      el("th", {}, "vs"), el("th", {}, "Matches"), el("th", {}, "Dev"),
      el("th", {}, "Result — win / draw / loss"))),
    el("tbody", {}, ...rows.map((r) => histRow(r, best))));
  root.innerHTML = ""; root.append(table);
}
function histRow(r, best) {
  const w = ((r.win_rate ?? r.summary?.mean_win_rate) || 0) * 100;
  const d = ((r.draw_rate ?? r.summary?.mean_draw_rate) || 0) * 100;
  const l = (r.loss_rate || 0) * 100;
  const bars = el("div", { class: "mini-bars" });
  if (w > 0) bars.append(el("div", { class: "bar win", style: `width:${w}%` }));
  if (d > 0) bars.append(el("div", { class: "bar draw", style: `width:${d}%` }));
  if (l > 0) bars.append(el("div", { class: "bar loss", style: `width:${l}%` }));
  const when = r.ts ? new Date(r.ts * 1000).toLocaleString() : "—";
  const model = (r.model || "—").replace(/^runs\//, "").replace(/\/final_model\.zip$/, " / final").replace(/\.zip$/, "");
  const score = promotionRankScore(r);
  const isBest = score === best && best > 0;
  const b = r.behavior;
  const bTip = b ? Object.entries(BEHAVIOR_INFO)
    .filter(([k]) => b[k] != null)
    .map(([k, info]) => `${info.label} ${Math.round(b[k] * 100)}%`).join(" · ") : "";
  return el("tr", { class: isBest ? "best-row" : "" },
    el("td", { class: "muted nowrap" }, when),
    el("td", { title: bTip ? "behavior: " + bTip : "" }, model,
      isBest ? el("span", { class: "chip best" }, "★ best") : null),
    el("td", {}, r.mode || "—"),
    el("td", {}, r.mode === "combat" ? "random (1v1)" : (r.opponent || "—")),
    el("td", {}, fmtInt(r.matches)),
    el("td", {}, r.device || "cpu"),
    el("td", {}, el("div", { class: "hist-result" },
      el("span", { class: "winpct" }, Math.round(w) + "%"), bars)));
}
function promotionRankScore(r) {
  const s = r.summary || {};
  if (s.anti_bait_score != null) {
    const gates = [s.lone_wolf_score, s.frozen_snapshot_score, s.promotion_score]
      .filter((v) => typeof v === "number");
    const floor = gates.length ? Math.min(...gates) : s.anti_bait_score;
    const trapPenalty = typeof s.trap_death_rate === "number" ? Math.max(0, s.trap_death_rate - 0.2) : 0;
    return Math.min(s.anti_bait_score, floor) - trapPenalty;
  }
  return r.win_rate ?? s.lone_wolf_score ?? s.promotion_score ?? 0;
}
$("#btnHistRefresh").addEventListener("click", loadEvalHistory);
$("#btnHistSort").addEventListener("click", () => {
  histSortBest = !histSortBest;
  $("#btnHistSort").textContent = "Sort: " + (histSortBest ? "Best win rate" : "Newest");
  loadEvalHistory();
});
$("#btnHistClear").addEventListener("click", async () => {
  if (!confirm("Clear all evaluation history? This deletes eval_history.jsonl.")) return;
  await api.post("/api/eval/history/clear", {});
  loadEvalHistory();
});

function renderEvalResult(r) {
  if (r.summary && Array.isArray(r.scenarios)) {
    renderEvalMatrixResult(r);
    return;
  }
  const w = (r.win_rate || 0) * 100, l = (r.loss_rate || 0) * 100, d = (r.draw_rate || 0) * 100;
  const bars = el("div", { class: "bars" });
  if (w > 0) bars.append(el("div", { class: "bar win", style: `width:${w}%` }, w >= 8 ? Math.round(w) + "%" : ""));
  if (d > 0) bars.append(el("div", { class: "bar draw", style: `width:${d}%` }, d >= 8 ? Math.round(d) + "%" : ""));
  if (l > 0) bars.append(el("div", { class: "bar loss", style: `width:${l}%` }, l >= 8 ? Math.round(l) + "%" : ""));
  const summary = el("div", { class: "summary" },
    el("div", {}, el("span", { class: "big" }, Math.round(w) + "% wins"), " over " + fmtInt(r.episodes) + " matches"),
    el("div", { class: "muted" }, `win ${fmtNum(r.win_rate)} · draw ${fmtNum(r.draw_rate)} · loss ${fmtNum(r.loss_rate)}`
      + (r.ep_return != null ? ` · avg return ${fmtNum(r.ep_return)}` : "")
      + (r.decision_interval ? ` · decision interval ${r.decision_interval}` : "")));
  if (r.observation_version) {
    summary.append(el("div", { class: "muted" }, `obs v${r.observation_version}`));
  }
  const reco = el("div", { id: "evalReco", class: "eval-reco" });
  $("#evalResult").innerHTML = ""; $("#evalResult").append(bars, summary);
  const behavior = behaviorChips(r.behavior);
  if (behavior) $("#evalResult").append(behavior);
  $("#evalResult").append(reco);
  renderEvalAdvice(r);
}

function renderEvalMatrixResult(r) {
  const scenarioRows = (scenarios, options = {}) => scenarios.map((s) => {
    const b = s.behavior || {};
    const score = s.win_score != null ? s.win_score : 0;
    const scoreClass = score >= 0.75 ? "good-cell" : score <= 0.15 ? "bad-cell" : "";
    const randomBaseline = s.random_baseline != null ? s.random_baseline : 0;
    return el("tr", {},
      el("td", {}, s.name),
      el("td", { class: scoreClass, title: "0 = random baseline, 1 = perfect win rate for this scenario" },
        fmtNum(score)),
      el("td", {}, `${Math.round((s.win_rate || 0) * 100)}%`),
      el("td", {}, `${Math.round(randomBaseline * 100)}%`),
      el("td", {}, `${Math.round((s.draw_rate || 0) * 100)}%`),
      options.trap ? el("td", {}, `${Math.round((s.trap_death_rate || 0) * 100)}%`) : null,
      el("td", {}, s.world_size || "-"),
      el("td", {}, s.kill_target || "-"),
      el("td", {}, `${Math.round((b.attack_rate || 0) * 100)}% / ${Math.round((b.dash_rate || 0) * 100)}% / ${Math.round((b.action_repeat_rate || 0) * 100)}%`));
  });
  const scenarioTable = (scenarios, title, options = {}) => el("div", {},
    title ? el("h3", { style: "margin:14px 0 0" }, title) : null,
    el("table", { class: "guide-table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Scenario"), el("th", { title: "0 = random baseline, 1 = perfect" }, "Score"),
        el("th", {}, "Win"), el("th", {}, "Random"), el("th", {}, "Draw"),
        options.trap ? el("th", {}, "Trap deaths") : null,
        el("th", {}, "World"), el("th", {}, "Kills"), el("th", {}, "Atk / dash / repeat"))),
      el("tbody", {}, ...scenarioRows(scenarios, options))));
  const table = scenarioTable(r.scenarios, "");
  const s = r.summary;
  const summary = el("div", { class: "summary" },
    el("div", {}, el("span", { class: "big" }, fmtNum(s.lone_wolf_score ?? s.promotion_score)), " lone-wolf score"),
    el("div", { class: "muted" },
      `mean scenario score ${fmtNum(s.mean_scenario_win_score ?? s.promotion_score ?? 0)} (0 = random, 1 = perfect)`
      + ` · mean draw ${Math.round(s.mean_draw_rate * 100)}% · human-likeness penalty ${Math.round(s.human_likeness_penalty * 100)}%`
      + (s.baseline_source ? ` (bands: ${s.baseline_source})` : "")
      + (r.decision_interval ? ` · decision interval ${r.decision_interval}` : "")
      + (r.frame_stack ? ` · frame stack ${r.frame_stack}` : "")));
  const reco = el("div", { id: "evalReco", class: "eval-reco" });
  if (r.observation_version) {
    summary.append(el("div", { class: "muted" }, `obs v${r.observation_version}`));
  }
  if (s.anti_bait_score != null) {
    const frozen = s.frozen_snapshot_score != null ? fmtNum(s.frozen_snapshot_score) : "missing";
    summary.append(el("div", { class: "muted" },
      `anti-bait ${fmtNum(s.anti_bait_score)} | trap deaths ${Math.round((s.trap_death_rate || 0) * 100)}% | frozen snapshot ${frozen}`));
    summary.append(el("div", { class: s.strict_promotion_ready ? "good-cell" : "bad-cell" },
      `strict promotion: ${s.strict_promotion_ready ? "ready" : "not ready"}`));
  }
  $("#evalResult").innerHTML = "";
  $("#evalResult").append(summary, table);
  if (Array.isArray(r.frozen_snapshots) && r.frozen_snapshots.length) {
    $("#evalResult").append(scenarioTable(r.frozen_snapshots, "Frozen snapshot matrix"));
  }
  if (Array.isArray(r.anti_bait) && r.anti_bait.length) {
    $("#evalResult").append(scenarioTable(r.anti_bait, "Anti-bait matrix", { trap: true }));
  }
  // Behavior chips for the duel scenario (the cleanest read on movement style).
  const duel = r.scenarios.find((x) => (x.world_size || 2) === 2) || r.scenarios[0];
  const chips = behaviorChips(duel && duel.behavior);
  if (chips) $("#evalResult").append(chips);
  $("#evalResult").append(reco);
  renderEvalAdvice({ ...r, win_rate: s.mean_win_rate, draw_rate: s.mean_draw_rate, mode: "combat" });
}

// Human-likeness snapshot: how the policy *moves*, not just whether it wins.
const BEHAVIOR_INFO = {
  idle_frac: { label: "idle", help: "Fraction of decisions with no movement input. Humans idle a little; ~0 = relentless robot, high = passive." },
  move_switch_rate: { label: "twitchiness", help: "How often the move direction changes between decisions. Humans hold a heading (≲0.3); ≳0.5 looks robotic-jittery." },
  action_repeat_rate: { label: "repeat", help: "Fraction of decisions repeating the exact previous action." },
  aim_enemy_rate: { label: "enemy aim", help: "Fraction of decisions using the nearest-enemy aim factor." },
  attack_rate: { label: "attacking", help: "Fraction of decisions pressing an attack." },
  jump_rate: { label: "jumping", help: "Fraction of decisions jumping." },
  dash_rate: { label: "dashing", help: "Fraction of decisions dashing." },
};
// Human bands ({metric: [lo, hi]}) — replay-derived when human_baseline.json exists.
let BASELINE = null;
async function loadBaseline() {
  if (BASELINE) return BASELINE;
  try { BASELINE = await api.get("/api/baseline"); } catch { BASELINE = { bands: {}, source: "defaults" }; }
  return BASELINE;
}
loadBaseline();

function behaviorChips(b) {
  if (!b) return null;
  const bands = (BASELINE && BASELINE.bands) || {};
  const src = (BASELINE && BASELINE.source) || "defaults";
  const wrap = el("div", { class: "behavior-chips" },
    el("span", { class: "muted bc-title", title: `human bands from ${src}` }, "behavior:"));
  for (const [k, info] of Object.entries(BEHAVIOR_INFO)) {
    if (b[k] == null) continue;
    const band = bands[k];
    let cls = "bchip", note = "";
    if (band) {
      const [lo, hi] = band;
      const status = b[k] > hi ? "high" : b[k] < lo ? "low" : "in";
      cls += " band-" + status;
      note = `  ·  human ${Math.round(lo * 100)}–${Math.round(hi * 100)}%`
        + (status === "in" ? " ✓" : status === "high" ? " (above)" : " (below)");
    }
    wrap.append(el("span", { class: cls, title: info.help + note },
      info.label + " ", el("b", {}, Math.round(b[k] * 100) + "%")));
  }
  return wrap;
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
  const mode = r.mode || "combat";
  const opp = r.opponent || "random";
  const model = r.model || "";
  const items = [];
  const set = (label, field, value, why) => items.push({ label, field, value, why });
  const note = (label, value, why) => items.push({ label, field: null, value, why });
  const num = (k, d) => { const v = Number(cfg[k]); return Number.isFinite(v) ? v : d; };
  const moreSteps = () => Math.round(num("total_steps", 5000000) * 1.5);
  let headline;

  if (mode === "combat") {
    // The board's combat eval is a 1v1 vs random — a floor test, not proof of FFA/team skill.
    const kill = num("reward_kill", 0.2);
    const approach = num("reward_approach", 0.05);
    const mm = num("match_minutes", 1.3);
    const killMin = num("combat_kill_min", 10);
    const killFloor = round(Math.max(0.2, approach * 4), 3);  // kills should clearly out-pay positioning

    if (wr >= 0.85) {
      headline = { level: "good", text: "Strong in the 1v1-vs-random test — but that only proves 1v1. Harden it, then validate bigger worlds." };
      set("[randomize] enabled", "randomize_enabled", true, "train across a band of balance settings so it survives live patches");
      if (num("randomize_pct", 0) <= 0) set("[randomize] pct", "randomize_pct", 0.15, "±15% mechanics jitter");
      if (model) set("[network] init_model", "init_model", model, "warm-start from this brain (keep width/depth)");
      set("[logging] dir", "logdir",
        /dr/.test(String(cfg.logdir || "")) ? bumpDir(cfg.logdir) : "runs/combat_dr",
        "new folder for the hardening run");
      note("Validate (Evaluate tab)", "raise the kill target", "the grade was 1v1 vs random — re-run Evaluate with a higher kill target before trusting FFA/team play");
    } else if (wr >= 0.55) {
      headline = { level: "warn", text: "Beats random 1v1 but isn't dominant — keep training this same brain." };
      if (model) set("[network] init_model", "init_model", model, "warm-start (continue), don't restart from scratch");
      set("[run] total_steps", "total_steps", moreSteps(), "more experience (~×1.5)");
      if (approach >= 0.05) set("[reward] approach", "reward_approach", 0.03, "shrink the positioning foothold so it commits to kills instead of circling");
      set("[logging] dir", "logdir", bumpDir(cfg.logdir), "keep runs separate");
    } else {
      headline = { level: "bad", text: "Barely beating a random 1v1 — it hasn't learned to fight. Make the kill signal reachable, then add time." };
      if (approach < 0.05) set("[reward] approach", "reward_approach", 0.05, "the foothold that leads a fresh brain to the enemy");
      if (kill < approach * 4) set("[reward] kill", "reward_kill", killFloor, `make kills clearly out-pay positioning (≈4× approach; now ${kill})`);
      if (mm > 1.5) set("[run] match_minutes", "match_minutes", 1.0, "short rounds resolve → many more episodes");
      if (killMin > 6) set("[combat] kill_min", "combat_kill_min", 5, "fewer kills to end a round → faster, denser learning signal");
      set("[run] total_steps", "total_steps", moreSteps(), "hard-exploration needs volume (~×1.5)");
      note("[combat] world_sizes", "weight toward 2s", "more 1v1s in the mix give a cleaner early signal — edit the list by hand");
    }

    // Timeouts: rounds not resolving (independent of win level).
    if (draw >= 0.2) {
      if (mm > 1.0) set("[run] match_minutes", "match_minutes", round(Math.max(1, mm * 0.7), 1), "lots of timeouts — give rounds less time to stall");
      if (killMin > 5) set("[combat] kill_min", "combat_kill_min", 5, "lower the kill target so rounds actually end");
      if (kill < approach * 4) set("[reward] kill", "reward_kill", killFloor, "pay it to finish kills, not just chase");
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
  if (mode !== "combat" && draw >= 0.3) {
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

// ================= OPTIMIZER =================
let hwLoaded = false;
let queueTimer = null;

async function loadOptimizer() {
  if (!hwLoaded) { hwLoaded = true; loadHardware(); }
  buildSweepKnobs();
  pollQueue();
}

async function loadHardware() {
  let hw;
  try { hw = await api.get("/api/hardware"); }
  catch { $("#hwSpecs").textContent = "Hardware detection failed."; return; }
  const specs = $("#hwSpecs");
  specs.className = "hw-specs";
  specs.innerHTML = "";
  specs.append(
    el("span", { class: "bchip" }, "CPU ", el("b", {}, hw.cpus + " threads")),
    el("span", { class: "bchip" }, "RAM ", el("b", {}, hw.ram_gb != null ? hw.ram_gb + " GB" : "?")),
    el("span", { class: "bchip" }, "GPU ", el("b", {}, hw.gpu_name
      ? `${hw.gpu_name} (${hw.gpu_vram_gb} GB)` : "none detected")));

  const rec = hw.recommended || {};
  const rows = Object.entries(rec).map(([k, v]) =>
    el("tr", {}, el("td", {}, el("code", {}, k)),
      el("td", {}, el("code", {}, Array.isArray(v) ? summarizeList(v) : String(v)))));
  const table = el("table", { class: "guide-table" },
    el("thead", {}, el("tr", {}, el("th", {}, "Setting"), el("th", {}, "Recommended"))),
    el("tbody", {}, ...rows));
  const apply = el("button", {
    class: "btn primary", style: "margin-top:10px",
    onclick: (e) => applyConfigPatch(rec, e.currentTarget),
  }, "Apply recommended to config");
  const note = el("p", { class: "muted", style: "margin:8px 0 0" },
    "Sized so the CPU-bound sim keeps the GPU fed: a worker per spare thread, ~3 worlds each, "
    + "frame-skip 5 (human cadence), big clean rollout buffers. Your reward weights are untouched.");
  $("#hwReco").innerHTML = "";
  $("#hwReco").append(table, apply, note);
}

function summarizeList(v) {
  // [2,2,2,...,4,4,8] -> "2×24, 4×12, 8×4" (readable world mixes)
  const counts = {};
  v.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
  return Object.entries(counts).map(([k, n]) => `${k}×${n}`).join(", ") + `  (${v.length} worlds)`;
}

function buildSweepKnobs() {
  const sel = $("#sweepKnob");
  if (!SCHEMA || sel.options.length) return;
  for (const section of SCHEMA.sections) {
    const group = el("optgroup", { label: section.title });
    for (const knob of section.knobs) {
      if (knob.type !== "int" && knob.type !== "float") continue;
      if (["total_steps", "save_every", "eval_every", "eval_episodes", "seed"].includes(knob.field)) continue;
      group.append(el("option", { value: knob.field, "data-type": knob.type },
        `${section.section}.${knob.key}`));
    }
    if (group.children.length) sel.append(group);
  }
  sel.addEventListener("change", sweepHint);
  $("#sweepValues").addEventListener("input", sweepHint);
}

function parseSweepValues() {
  return $("#sweepValues").value.split(",").map((s) => s.trim()).filter(Boolean)
    .map(Number).filter((v) => Number.isFinite(v));
}

function sweepHint() {
  const vals = parseSweepValues();
  $("#sweepHint").textContent = vals.length
    ? `${vals.length} probe run(s): ` + vals.map((v) => sweepDirName($("#sweepKnob").value, v)).join(", ")
    : "";
}

function sweepDirName(field, v) {
  const safe = String(v).replace(/\./g, "p").replace(/-/g, "m");
  return `runs/sweep_${field}_${safe}`;
}

$("#btnSweepAdd").addEventListener("click", async (e) => {
  const field = $("#sweepKnob").value;
  const vals = parseSweepValues();
  if (!field || !vals.length) { flash(e.currentTarget, "Pick knob + values", false); return; }
  const probeSteps = Number($("#sweepSteps").value) || 2000000;
  const base = collectValues();  // current Train-tab settings = the sweep baseline
  const jobs = vals.map((v) => ({
    name: `${field} = ${v}`,
    values: { ...base, [field]: v, total_steps: probeSteps, logdir: sweepDirName(field, v) },
  }));
  const res = await api.post("/api/queue/add", { jobs });
  flash(e.currentTarget, res.ok ? `Queued ${jobs.length} ✓` : (res.error || "Error"), res.ok);
  pollQueue();
});

$("#btnQueueStart").addEventListener("click", async (e) => {
  const res = await api.post("/api/queue/start", {});
  flash(e.currentTarget, res.ok ? "Running ✓" : (res.error || "Error"), res.ok);
  pollQueue(); pollTrain();
});
$("#btnQueuePause").addEventListener("click", async () => { await api.post("/api/queue/pause", {}); pollQueue(); });
$("#btnQueueClear").addEventListener("click", async () => { await api.post("/api/queue/clear_finished", {}); pollQueue(); });

async function pollQueue() {
  let st;
  try { st = await api.get("/api/queue"); } catch { return; }
  renderQueue(st);
  clearTimeout(queueTimer);
  const visible = $("#tab-optimizer").classList.contains("active");
  if (visible && (st.running || (st.jobs || []).some((j) => j.state === "running"))) {
    queueTimer = setTimeout(pollQueue, 2500);
  } else if (visible) {
    queueTimer = setTimeout(pollQueue, 8000);
  }
}

function renderQueue(st) {
  const root = $("#queueList");
  const jobs = st.jobs || [];
  if (!jobs.length) { root.innerHTML = '<p class="muted">No jobs queued. Build a sweep above, or queue any config.</p>'; return; }

  const doneJobs = jobs.filter((j) => j.state === "done" && j.summary);
  const bestScore = Math.max(...doneJobs.map((j) => j.summary.rank_score ?? -Infinity));

  const rows = jobs.map((j) => {
    const s = j.summary || {};
    const isBest = j.state === "done" && s.rank_score != null && s.rank_score === bestScore && doneJobs.length > 1;
    const actions = el("td", { class: "nowrap" });
    if (j.state === "done") {
      actions.append(el("button", {
        class: "btn tiny primary", title: "Make this job's settings the current config",
        onclick: (e) => applyConfigPatch(j.values, e.currentTarget),
      }, "Use config"));
      actions.append(" ");
    }
    if (j.state !== "running") {
      actions.append(el("button", {
        class: "btn tiny ghost", title: "Remove from queue",
        onclick: async () => { await api.post("/api/queue/remove", { id: j.id }); pollQueue(); },
      }, "✕"));
    }
    return el("tr", { class: isBest ? "best-row" : "" },
      el("td", {}, j.name, isBest ? el("span", { class: "chip best" }, "★ best") : null,
        el("div", { class: "muted", style: "font-size:11px" }, j.logdir)),
      el("td", {}, el("span", { class: "badge q-" + j.state }, j.state)),
      el("td", {}, s.step != null ? fmtInt(s.step) : "—"),
      el("td", {}, s.ep_rew_mean != null ? fmtNum(s.ep_rew_mean) : "—"),
      el("td", {}, s.win_rate != null ? Math.round(s.win_rate * 100) + "%" : "—"),
      el("td", {}, s.fps != null ? fmtInt(s.fps) : "—"),
      el("td", {}, s.lone_wolf_score != null ? fmtNum(s.lone_wolf_score) : "-"),
      el("td", {}, s.anti_bait_score != null ? fmtNum(s.anti_bait_score) : "-"),
      el("td", {}, s.frozen_snapshot_score != null ? fmtNum(s.frozen_snapshot_score) : "-"),
      el("td", { class: s.strict_promotion_ready ? "good-cell" : "" },
        s.strict_promotion_ready ? "ready" : "-"),
      actions);
  });
  const table = el("table", { class: "guide-table queue-table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Job"), el("th", {}, "State"), el("th", {}, "Steps"),
      el("th", {}, "Reward"), el("th", {}, "Win rate"), el("th", {}, "FPS"), el("th", {}, "Lone wolf"),
      el("th", {}, "Anti-bait"), el("th", {}, "Frozen"), el("th", {}, "Strict"), el("th", {}, ""))),
    el("tbody", {}, ...rows));
  root.innerHTML = "";
  root.append(el("p", { class: "muted", style: "margin:0 0 8px" },
    st.running ? "Queue is running — jobs advance automatically." : "Queue is paused."), table);
}

// ================= WATCH (top-down match playback) =================
const TEAM_COLORS = ["#4f9dff", "#f85149", "#3fb950", "#d29922", "#7c5cff", "#36c5c5", "#e879f9", "#a3e635"];
let watchTraj = null;       // {meta, outcome, frames}
let watchFrame = 0;
let watchPlaying = false;
let watchLastTick = 0;
let watchAcc = 0;
let watchStatusTimer = null;
let watchModelsLoaded = false;
let watchTeamColor = {};

async function loadWatch() {
  if (!watchModelsLoaded) {
    watchModelsLoaded = true;
    try {
      const data = await api.get("/api/models");
      const sel = $("#watchModel");
      sel.innerHTML = "";
      (data.models || []).filter((m) => m.mode !== "grifball")
        .forEach((m) => sel.append(el("option", { value: m.path }, m.label)));
    } catch {}
  }
  pollWatchStatus();
  if (!watchTraj) loadWatchTrajectory();   // last recording auto-loads
}

$("#btnWatchRecord").addEventListener("click", async () => {
  const res = await api.post("/api/watch/start", {
    model: $("#watchModel").value,
    world_size: Number($("#watchWorldSize").value),
    kill_target: Number($("#watchKillTarget").value),
    opponent: $("#watchOpponent").value,
  });
  if (!res.ok) { $("#watchState").textContent = res.error || "error"; return; }
  $("#watchState").textContent = "recording…";
  pollWatchStatus();
});
$("#btnWatchStop").addEventListener("click", async () => { await api.post("/api/watch/stop", {}); pollWatchStatus(); });

async function pollWatchStatus() {
  let st;
  try { st = await api.get("/api/watch/status"); } catch { return; }
  $("#btnWatchRecord").disabled = st.running;
  $("#btnWatchStop").disabled = !st.running;
  $("#watchState").textContent = st.running ? "recording…" : (st.state === "idle" ? "" : st.state);
  $("#watchLog").textContent = (st.log || []).join("\n");
  const bar = $("#watchProgress");
  if (st.running) {
    bar.style.display = "block";
    const pct = st.progress != null ? Math.round(st.progress * 100) : 0;
    $("#watchProgressFill").style.width = pct + "%";
    $("#watchProgressLabel").textContent = st.progress != null ? pct + "%" : "spinning up sim…";
  } else {
    bar.style.display = "none";
  }
  clearTimeout(watchStatusTimer);
  if (st.running) {
    watchStatusTimer = setTimeout(pollWatchStatus, 1200);
  } else if (st.has_trajectory && (!watchTraj || (st.trajectory_mtime || 0) * 1000 > (watchTraj.loadedAt || 0))) {
    loadWatchTrajectory();
  }
}

async function loadWatchTrajectory() {
  let traj;
  try {
    const r = await fetch("/api/watch/trajectory");
    if (!r.ok) return;
    traj = await r.json();
  } catch { return; }
  if (!traj || !Array.isArray(traj.frames) || !traj.frames.length) return;
  traj.loadedAt = Date.now();
  watchTraj = traj;
  watchFrame = 0;
  watchPlaying = false;
  $("#btnWatchPlay").textContent = "▶ Play";
  // Stable team colors in first-seen order.
  watchTeamColor = {};
  let ci = 0;
  for (const c of traj.frames[0].combatants) {
    if (!(c.team in watchTeamColor)) watchTeamColor[c.team] = TEAM_COLORS[ci++ % TEAM_COLORS.length];
  }
  const m = traj.meta || {};
  const o = traj.outcome || {};
  $("#watchMeta").textContent =
    `${(m.model || "?").replace("runs/", "")} · ${m.world_size}-player vs ${m.opponent}`
    + ` · kill target ${m.kill_target} · ${traj.frames.length} frames`
    + ` @ ${(1 / (m.seconds_per_frame || 0.0833)).toFixed(0)}/s`
    + (o.ended ? (o.truncated ? " · timed out" : " · decisive finish") : " · cut short");
  const scrub = $("#watchScrub");
  scrub.max = traj.frames.length - 1;
  scrub.value = 0;
  drawWatchFrame();
  requestAnimationFrame(watchLoop);
}

$("#btnWatchPlay").addEventListener("click", () => {
  if (!watchTraj) return;
  watchPlaying = !watchPlaying;
  if (watchPlaying && watchFrame >= watchTraj.frames.length - 1) watchFrame = 0; // replay
  watchLastTick = performance.now();
  $("#btnWatchPlay").textContent = watchPlaying ? "⏸ Pause" : "▶ Play";
  if (watchPlaying) requestAnimationFrame(watchLoop);
});
$("#watchScrub").addEventListener("input", () => {
  watchFrame = Number($("#watchScrub").value) || 0;
  drawWatchFrame();
});

function watchLoop(now) {
  if (!watchTraj) return;
  if (watchPlaying) {
    const spf = (watchTraj.meta.seconds_per_frame || 1 / 12) / Number($("#watchSpeed").value || 1);
    watchAcc += (now - watchLastTick) / 1000;
    watchLastTick = now;
    while (watchAcc >= spf && watchFrame < watchTraj.frames.length - 1) {
      watchAcc -= spf;
      watchFrame++;
    }
    if (watchFrame >= watchTraj.frames.length - 1) {
      watchPlaying = false;
      $("#btnWatchPlay").textContent = "▶ Replay";
    }
    $("#watchScrub").value = watchFrame;
    drawWatchFrame();
  }
  if (watchPlaying) requestAnimationFrame(watchLoop);
}

function drawWatchFrame() {
  const traj = watchTraj;
  if (!traj) return;
  const f = traj.frames[Math.min(watchFrame, traj.frames.length - 1)];
  const canvas = $("#watchCanvas");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const arena = f.arena || { halfX: 30, halfZ: 20 };
  const cssH = Math.max(260, cssW * (arena.halfZ / arena.halfX));
  canvas.style.height = cssH + "px";
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Arena floor + grid
  ctx.fillStyle = "#0a0d12";
  ctx.fillRect(0, 0, cssW, cssH);
  const pad = 14;
  const sx = (x) => pad + ((x + arena.halfX) / (2 * arena.halfX)) * (cssW - 2 * pad);
  const sy = (z) => pad + ((z + arena.halfZ) / (2 * arena.halfZ)) * (cssH - 2 * pad);
  ctx.strokeStyle = "#1b2330"; ctx.lineWidth = 1;
  for (let gx = -arena.halfX; gx <= arena.halfX; gx += 8) {
    ctx.beginPath(); ctx.moveTo(sx(gx), sy(-arena.halfZ)); ctx.lineTo(sx(gx), sy(arena.halfZ)); ctx.stroke();
  }
  for (let gz = -arena.halfZ; gz <= arena.halfZ; gz += 8) {
    ctx.beginPath(); ctx.moveTo(sx(-arena.halfX), sy(gz)); ctx.lineTo(sx(arena.halfX), sy(gz)); ctx.stroke();
  }
  ctx.strokeStyle = "#2a323d"; ctx.lineWidth = 2;
  ctx.strokeRect(sx(-arena.halfX), sy(-arena.halfZ),
    sx(arena.halfX) - sx(-arena.halfX), sy(arena.halfZ) - sy(-arena.halfZ));

  // Ball (grifball)
  if (f.ball) {
    ctx.fillStyle = "#ffb02e";
    ctx.beginPath(); ctx.arc(sx(f.ball.x), sy(f.ball.z), 5, 0, Math.PI * 2); ctx.fill();
  }

  // Combatants
  const r = 9;
  for (const c of f.combatants) {
    const X = sx(c.x), Y = sy(c.z);
    const color = watchTeamColor[c.team] || "#888";
    ctx.globalAlpha = c.alive ? 1 : 0.25;
    // facing line (engine forward = (sin yaw, cos yaw))
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X, Y);
    ctx.lineTo(X + Math.sin(c.yaw) * r * 1.9, Y + Math.cos(c.yaw) * r * 1.9); ctx.stroke();
    // body
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
    if (c.hasBall) { ctx.strokeStyle = "#ffb02e"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(X, Y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
    // weapon glyph
    ctx.fillStyle = "#001";
    ctx.font = "bold 9px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(c.weapon === "hammer" ? "H" : c.weapon === "sword" ? "S" : "B", X, Y);
    // hp bar
    if (c.alive && c.maxHp > 0) {
      const w = r * 2, frac = Math.max(0, Math.min(1, c.hp / c.maxHp));
      ctx.fillStyle = "#000"; ctx.fillRect(X - r, Y - r - 6, w, 3);
      ctx.fillStyle = frac > 0.5 ? "#3fb950" : frac > 0.25 ? "#d29922" : "#f85149";
      ctx.fillRect(X - r, Y - r - 6, w * frac, 3);
    }
    // id label
    ctx.globalAlpha = c.alive ? 0.85 : 0.3;
    ctx.fillStyle = "#8b97a7"; ctx.font = "9px system-ui";
    ctx.fillText(c.id, X, Y + r + 8);
    ctx.globalAlpha = 1;
  }

  // Clock + scoreboard
  const secs = (f.tick || 0) / 60;
  $("#watchClock").textContent =
    `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}  ·  ${f.phase}`;
  const score = $("#watchScore");
  score.innerHTML = "";
  for (const [team, s] of Object.entries(f.scores || {})) {
    score.append(el("span", { class: "bchip", style: `border-color:${watchTeamColor[team] || "#888"}` },
      el("i", { class: "team-dot", style: `background:${watchTeamColor[team] || "#888"}` }),
      `${team}  `, el("b", {}, String(f.mode === "combat" ? s.kills : s.goals))));
  }
  score.append(el("span", { class: "muted", style: "margin-left:8px" },
    `target ${f.killTarget}`));
}

window.addEventListener("resize", () => {
  if ($("#tab-watch").classList.contains("active")) drawWatchFrame();
});

// ================= boot =================
loadConfig();
pollTrain();
window.addEventListener("resize", () => {
  if ($("#tab-runs").classList.contains("active")) renderRunComparison();
});
