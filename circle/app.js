const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const resultEl = document.getElementById("result");
const gradeEl = document.getElementById("grade");
const piValueEl = document.getElementById("piValue");
const scoreValueEl = document.getElementById("scoreValue");
const roundnessValueEl = document.getElementById("roundnessValue");
const emojiLineEl = document.getElementById("emojiLine");
const hintEl = document.getElementById("hint");
const emojiBurstEl = document.getElementById("emojiBurst");
const resetBtn = document.getElementById("resetBtn");
const appEl = document.querySelector(".app");
const playerNameInput = document.getElementById("playerName");
const syncStatusEl = document.getElementById("syncStatus");
const leaderboardBtn = document.getElementById("leaderboardBtn");
const leaderboardPanel = document.getElementById("leaderboardPanel");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardSubtitleEl = document.getElementById("leaderboardSubtitle");
const closeBoardBtn = document.getElementById("closeBoardBtn");
const clearBoardBtn = document.getElementById("clearBoardBtn");
const bestNameEl = document.getElementById("bestName");
const bestScoreEl = document.getElementById("bestScore");
const entryCountEl = document.getElementById("entryCount");

const rootStyles = getComputedStyle(document.documentElement);
const theme = {
  ink: rootStyles.getPropertyValue("--ink").trim() || "#e6f1ff",
  accent: rootStyles.getPropertyValue("--accent").trim() || "#4bd2ff",
};

const STORAGE_KEY = "pi_leaderboard_v1";
const NAME_KEY = "pi_player_name_v1";

const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const state = {
  points: [],
  drawing: false,
  minDist: 5,
  minDim: 0,
  thresholds: {
    closeGap: 0,
    closeRadius: 0,
    absurdGap: 0,
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const distance = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

const average = (values) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

const stdDev = (values, mean) => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) {
    const d = v - mean;
    sum += d * d;
  }
  return Math.sqrt(sum / values.length);
};

const det3 = (a, b, c, d, e, f, g, h, i) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

const getCanvasPoint = (event) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const clearCanvas = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

const resizeCanvas = () => {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, 0.008 * Math.min(rect.width, rect.height));
  ctx.strokeStyle = theme.ink;

  state.minDim = Math.min(rect.width, rect.height);
  state.minDist = Math.max(3, 0.008 * state.minDim);
  state.thresholds = {
    closeGap: 0.1 * state.minDim,
    closeRadius: 0.06 * state.minDim,
    absurdGap: 0.22 * state.minDim,
  };

  clearCanvas();
  hideResult();
};

const hideResult = () => {
  resultEl.classList.add("hidden");
  resultEl.dataset.grade = "";
  emojiLineEl.textContent = "";
  if (emojiBurstEl) {
    emojiBurstEl.innerHTML = "";
  }
};

const resetAll = () => {
  state.points = [];
  state.drawing = false;
  clearCanvas();
  hideResult();
};

const loadLeaderboard = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && Number.isFinite(entry.score));
  } catch (err) {
    return [];
  }
};

const saveLeaderboard = (list) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    // Ignore storage failures.
  }
};

const loadPlayerName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch (err) {
    return "";
  }
};

const savePlayerName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch (err) {
    // Ignore storage failures.
  }
};

const sanitizeName = (value) => value.replace(/\s+/g, " ").trim().slice(0, 20);

const setSyncStatus = (state, text) => {
  syncStatusEl.className = `sync-status ${state}`;
  syncStatusEl.textContent = text;
};

const looksLikeJwt = (key) => key.split(".").length === 3;

const buildHeaders = () => {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (looksLikeJwt(SUPABASE_ANON_KEY)) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
};

const sortLeaderboard = (list) =>
  list
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.roundness !== a.roundness) return b.roundness - a.roundness;
      return a.piError - b.piError;
    });

const formatTime = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const parseContentRange = (value) => {
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length !== 2) return null;
  const total = Number(parts[1]);
  return Number.isFinite(total) ? total : null;
};

const normalizeEntry = (entry) => ({
  name: entry.name || "无名氏",
  score: Number(entry.score),
  grade: entry.grade || "D",
  pi: Number(entry.pi),
  roundness: Number(entry.roundness),
  piError: Number(entry.pi_error ?? entry.piError ?? 0),
  createdAt: entry.created_at ?? entry.createdAt,
});

const updateLeaderboardStats = (list, totalCount) => {
  if (!list.length) {
    bestNameEl.textContent = "--";
    bestScoreEl.textContent = "--";
    entryCountEl.textContent = totalCount ? totalCount.toString() : "0";
    return;
  }
  const best = list[0];
  bestNameEl.textContent = best.name || "无名氏";
  bestScoreEl.textContent = Number.isFinite(best.score) ? best.score.toString() : "--";
  entryCountEl.textContent = totalCount ? totalCount.toString() : list.length.toString();
};

const renderLeaderboard = (list, totalCount) => {
  leaderboardList.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "leaderboard-empty";
    empty.textContent = "还没有记录，去画一个试试";
    leaderboardList.appendChild(empty);
    updateLeaderboardStats(list, totalCount);
    return;
  }

  list.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item";
    if (index === 0) item.classList.add("top-1");
    if (index === 1) item.classList.add("top-2");
    if (index === 2) item.classList.add("top-3");

    const rank = document.createElement("div");
    rank.className = "leaderboard-rank";
    rank.textContent = `${index + 1}`;

    const info = document.createElement("div");
    info.style.flex = "1";

    const nameRow = document.createElement("div");
    nameRow.className = "leaderboard-name";
    const nameText = document.createElement("span");
    nameText.textContent = entry.name || "无名氏";
    nameRow.appendChild(nameText);
    if (index === 0) {
      const badge = document.createElement("span");
      badge.className = "leaderboard-badge";
      badge.textContent = "有缘人";
      nameRow.appendChild(badge);
    }

    const score = document.createElement("div");
    score.className = "leaderboard-score";
    score.textContent = Number.isFinite(entry.score) ? `${entry.score}` : "--";

    const meta = document.createElement("div");
    meta.className = "leaderboard-meta";
    const piValue = Number(entry.pi);
    const roundnessValue = Number(entry.roundness);
    const piText = Number.isFinite(piValue) ? piValue.toFixed(5) : "--";
    const roundnessText = Number.isFinite(roundnessValue) ? roundnessValue.toFixed(2) : "--";
    meta.textContent = `等级 ${entry.grade} · π ${piText} · 圆度 ${roundnessText}`;

    info.appendChild(nameRow);
    info.appendChild(score);
    info.appendChild(meta);

    const time = document.createElement("div");
    time.className = "leaderboard-time";
    time.textContent = formatTime(entry.createdAt);

    item.appendChild(rank);
    item.appendChild(info);
    item.appendChild(time);
    leaderboardList.appendChild(item);
  });

  updateLeaderboardStats(list, totalCount);
};

const emojiPools = {
  S: ["🔥", "🎯", "✨", "💫", "🌀", "🏆"],
  A: ["🎉", "👏", "⭐", "😎", "🚀"],
  B: ["👍", "✨", "🟦", "😄"],
  C: ["🙂", "💪", "🔁"],
  D: ["😅", "😵", "🔧"],
  default: ["✨", "🎯", "👍"],
};

const pickEmoji = (grade) => {
  const pool = emojiPools[grade] || emojiPools.default;
  return pool[Math.floor(Math.random() * pool.length)];
};

const setEmojiLine = (grade) => {
  const count = grade === "S" ? 6 : grade === "A" ? 5 : grade === "B" ? 4 : grade === "C" ? 3 : 2;
  const line = Array.from({ length: count }, () => pickEmoji(grade)).join(" ");
  emojiLineEl.textContent = line;
};

const launchEmojiBurst = (grade, point) => {
  if (!emojiBurstEl) return;
  const rect = canvas.getBoundingClientRect();
  const originX = point ? point.x : rect.width / 2;
  const originY = point ? point.y : rect.height / 2;
  const amount = grade === "S" ? 14 : grade === "A" ? 12 : 10;

  for (let i = 0; i < amount; i += 1) {
    const emoji = document.createElement("span");
    emoji.className = "emoji";
    emoji.textContent = pickEmoji(grade);
    const dx = (Math.random() - 0.5) * 160;
    const dy = -60 - Math.random() * 90;
    const size = 18 + Math.random() * 12;
    const duration = 1.1 + Math.random() * 0.6;
    emoji.style.left = `${originX}px`;
    emoji.style.top = `${originY}px`;
    emoji.style.setProperty("--dx", `${dx}px`);
    emoji.style.setProperty("--dy", `${dy}px`);
    emoji.style.setProperty("--emoji-size", `${size}px`);
    emoji.style.setProperty("--emoji-duration", `${duration}s`);
    emojiBurstEl.appendChild(emoji);
    emoji.addEventListener("animationend", () => emoji.remove(), { once: true });
  }
};

const isRemoteEnabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let localLeaderboard = sortLeaderboard(loadLeaderboard()).slice(0, 20);
let remoteLeaderboard = [];
let remoteCount = null;
let remoteLoaded = false;

const getActiveList = () => (remoteLoaded ? remoteLeaderboard : localLeaderboard);
const getActiveCount = () => (remoteLoaded ? remoteCount : localLeaderboard.length);

const renderActiveLeaderboard = () => {
  renderLeaderboard(getActiveList(), getActiveCount());
};

const refreshRemoteLeaderboard = async () => {
  if (!isRemoteEnabled()) return;
  setSyncStatus("loading", "同步中");
  leaderboardSubtitleEl.textContent = "联网排行 · 同步中...";
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard_entries?select=name,score,grade,pi,roundness,pi_error,created_at&order=score.desc,roundness.desc,pi_error.asc&limit=50`,
      {
        headers: {
          ...buildHeaders(),
          Prefer: "count=planned",
        },
      }
    );
    if (!response.ok) throw new Error("fetch_failed");
    const data = await response.json();
    remoteCount = parseContentRange(response.headers.get("content-range"));
    remoteLeaderboard = data.map(normalizeEntry);
    remoteLoaded = true;
    setSyncStatus("online", "联网");
    leaderboardSubtitleEl.textContent = "联网排行 · 显示前 50";
    renderActiveLeaderboard();
  } catch (err) {
    remoteLoaded = false;
    setSyncStatus("error", "离线");
    leaderboardSubtitleEl.textContent = "离线模式 · 仅本机";
    renderActiveLeaderboard();
  }
};

const submitRemoteEntry = async (payload) => {
  if (!isRemoteEnabled()) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard_entries`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("insert_failed");
    await refreshRemoteLeaderboard();
  } catch (err) {
    setSyncStatus("error", "离线");
    leaderboardSubtitleEl.textContent = "离线模式 · 仅本机";
  }
};

const openLeaderboard = () => {
  appEl.classList.add("leaderboard-open");
  leaderboardPanel.classList.remove("hidden");
  leaderboardPanel.setAttribute("aria-hidden", "false");
};

const closeLeaderboard = () => {
  appEl.classList.remove("leaderboard-open");
  leaderboardPanel.classList.add("hidden");
  leaderboardPanel.setAttribute("aria-hidden", "true");
};

const findCutIndex = (points, start, closeRadius) => {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (distance(points[i], start) <= closeRadius) {
      return i;
    }
  }
  return -1;
};

const closeAndTrim = (points) => {
  const start = points[0];
  const end = points[points.length - 1];
  const gap = distance(start, end);

  const cutIndex = findCutIndex(points, start, state.thresholds.closeRadius);
  const trimmed = cutIndex >= 0 ? points.slice(0, cutIndex + 1) : points.slice();

  const closed = trimmed.slice();
  if (trimmed.length > 0) {
    closed.push(trimmed[0]);
  }

  return {
    closed,
    trimmed,
    gap,
    cutIndex,
  };
};

const pathLength = (points) => {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    sum += distance(points[i], points[i + 1]);
  }
  return sum;
};

const polygonArea = (points) => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    sum += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
  }
  return Math.abs(sum) * 0.5;
};

const kasaFit = (points) => {
  if (points.length < 3) return null;

  let Sx = 0;
  let Sy = 0;
  let Sxx = 0;
  let Syy = 0;
  let Sxy = 0;
  let Sxxx = 0;
  let Syyy = 0;
  let Sxxy = 0;
  let Sxyy = 0;

  for (const p of points) {
    const x = p.x;
    const y = p.y;
    const xx = x * x;
    const yy = y * y;

    Sx += x;
    Sy += y;
    Sxx += xx;
    Syy += yy;
    Sxy += x * y;
    Sxxx += xx * x;
    Syyy += yy * y;
    Sxxy += xx * y;
    Sxyy += x * yy;
  }

  const a = Sxx;
  const b = Sxy;
  const c = Sx;
  const d = Sxy;
  const e = Syy;
  const f = Sy;
  const g = Sx;
  const h = Sy;
  const i = points.length;

  const det = det3(a, b, c, d, e, f, g, h, i);
  if (Math.abs(det) < 1e-10) return null;

  const bx = -(Sxxx + Sxyy);
  const by = -(Sxxy + Syyy);
  const bz = -(Sxx + Syy);

  const detA = det3(bx, b, c, by, e, f, bz, h, i);
  const detB = det3(a, bx, c, d, by, f, g, bz, i);
  const detC = det3(a, b, bx, d, e, by, g, h, bz);

  const A = detA / det;
  const B = detB / det;
  const C = detC / det;

  const xc = -A / 2;
  const yc = -B / 2;
  const r2 = xc * xc + yc * yc - C;

  if (!Number.isFinite(r2) || r2 <= 0) return null;

  return {
    x: xc,
    y: yc,
    r: Math.sqrt(r2),
    source: "kasa",
  };
};

const centroidFit = (points) => {
  if (points.length === 0) {
    return { x: 0, y: 0, r: 0, source: "centroid" };
  }

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;

  const distances = points.map((p) => distance(p, { x: cx, y: cy }));
  const r = average(distances);

  return { x: cx, y: cy, r, source: "centroid" };
};

const analyze = (points) => {
  const { closed, trimmed, gap } = closeAndTrim(points);
  const L = pathLength(closed);
  const A = polygonArea(closed);

  let fit = kasaFit(trimmed);
  if (!fit) {
    fit = centroidFit(trimmed);
  }

  const distances = trimmed.map((p) => distance(p, fit));
  const meanR = average(distances);
  const sigma = stdDev(distances, meanR);
  const sigmaRatio = fit.r > 0 ? sigma / fit.r : Infinity;

  let piEst = A > 0 && fit.r > 0 ? A / (fit.r * fit.r) : Number.NaN;
  if (!Number.isFinite(piEst) && fit.r > 0 && L > 0) {
    piEst = L / (2 * fit.r);
  }
  if (!Number.isFinite(piEst)) {
    piEst = 0;
  }

  const piError = Math.abs(piEst - Math.PI);
  const circleScore = clamp(1 - sigmaRatio / 0.12, 0, 1);
  const piScore = clamp(1 - piError / 0.22, 0, 1);

  const closureBad = gap > state.thresholds.closeGap;
  const closureAbsurd = gap > state.thresholds.absurdGap;

  let grade = "D";
  if (!closureAbsurd) {
    if (sigmaRatio <= 0.08 && piError < 0.012) grade = "S";
    else if (sigmaRatio <= 0.1 && piError < 0.035) grade = "A";
    else if (sigmaRatio <= 0.12 && piError < 0.07) grade = "B";
    else if (sigmaRatio <= 0.15 && piError < 0.12) grade = "C";
    else grade = "D";
  }

  if (closureBad && grade !== "D") {
    const downgrade = { S: "A", A: "B", B: "C", C: "D" };
    grade = downgrade[grade] || "D";
  }

  let score = Math.round(100 * (0.6 * circleScore + 0.4 * piScore));
  if (grade === "D") {
    score = Math.min(score, 55);
  }

  const absurd = closureAbsurd || sigmaRatio > 0.22 || fit.r <= 0 || trimmed.length < 8;

  let hint = "再稳一点会更圆";
  if (absurd) {
    hint = "离谱的圆？？？建议重试";
  } else if (sigmaRatio > 0.12) {
    hint = "圆度没过关，试着更均匀地画一圈";
  } else if (closureBad) {
    hint = "闭合不够紧，结尾回到起点附近";
  } else if (piError < 0.012) {
    hint = "非常接近真正的 π";
  }

  return {
    fit,
    piEst,
    grade,
    score,
    roundness: circleScore,
    hint,
    piError,
    absurd,
  };
};

const drawFitCircle = (fit) => {
  if (!fit || fit.r <= 0) return;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = Math.max(1.5, ctx.lineWidth * 0.6);
  ctx.strokeStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(fit.x, fit.y, fit.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const showResult = (data) => {
  gradeEl.textContent = data.grade;
  piValueEl.textContent = data.piEst.toFixed(5);
  scoreValueEl.textContent = data.score.toString();
  roundnessValueEl.textContent = data.roundness.toFixed(2);
  hintEl.textContent = data.hint;
  setEmojiLine(data.grade);
  resultEl.dataset.grade = data.grade;
  resultEl.classList.remove("hidden");
};

const getPlayerName = () => {
  const raw = sanitizeName(playerNameInput.value || loadPlayerName());
  return raw || "无名氏";
};

const buildLocalEntry = (data, name) => ({
  name,
  score: data.score,
  grade: data.grade,
  pi: Number(data.piEst.toFixed(5)),
  roundness: Number(data.roundness.toFixed(2)),
  piError: Number(data.piError.toFixed(5)),
  createdAt: new Date().toISOString(),
});

const buildRemotePayload = (data, name) => ({
  name,
  score: data.score,
  grade: data.grade,
  pi: Number(data.piEst.toFixed(5)),
  roundness: Number(data.roundness.toFixed(2)),
  pi_error: Number(data.piError.toFixed(5)),
});

const recordResult = (data) => {
  if (!Number.isFinite(data.score)) return;
  const name = getPlayerName();
  const entry = buildLocalEntry(data, name);
  localLeaderboard = sortLeaderboard([entry, ...localLeaderboard]).slice(0, 20);
  saveLeaderboard(localLeaderboard);
  if (!remoteLoaded) {
    renderActiveLeaderboard();
  }
  if (isRemoteEnabled()) {
    void submitRemoteEntry(buildRemotePayload(data, name));
  } else {
    setSyncStatus("offline", "未配置");
    leaderboardSubtitleEl.textContent = "离线模式 · 未配置联网";
  }
};

renderActiveLeaderboard();

const commitPlayerName = () => {
  const clean = sanitizeName(playerNameInput.value);
  playerNameInput.value = clean;
  savePlayerName(clean);
};

playerNameInput.value = loadPlayerName();
playerNameInput.addEventListener("blur", commitPlayerName);
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    commitPlayerName();
    playerNameInput.blur();
  }
});

if (isRemoteEnabled()) {
  setSyncStatus("loading", "同步中");
  leaderboardSubtitleEl.textContent = "联网排行 · 同步中...";
  refreshRemoteLeaderboard();
} else {
  setSyncStatus("offline", "未配置");
  leaderboardSubtitleEl.textContent = "离线模式 · 未配置联网";
}

const onPointerDown = (event) => {
  if (state.drawing) return;
  if (appEl.classList.contains("leaderboard-open")) return;
  if (!resultEl.classList.contains("hidden")) {
    resetAll();
  }

  state.drawing = true;
  state.points = [];

  const p = getCanvasPoint(event);
  state.points.push(p);

  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.strokeStyle = theme.ink;

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (err) {
    // Ignore if capture fails.
  }
};

const onPointerMove = (event) => {
  if (!state.drawing) return;

  const p = getCanvasPoint(event);
  const last = state.points[state.points.length - 1];
  if (!last || distance(p, last) >= state.minDist) {
    state.points.push(p);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
};

const onPointerUp = (event) => {
  if (!state.drawing) return;
  state.drawing = false;

  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (err) {
    // Ignore if release fails.
  }

  const result = analyze(state.points);
  drawFitCircle(result.fit);
  showResult(result);
  recordResult(result);
  launchEmojiBurst(result.grade, getCanvasPoint(event));
};

const onPointerCancel = (event) => {
  if (!state.drawing) return;
  state.drawing = false;

  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (err) {
    // Ignore if release fails.
  }

  const result = analyze(state.points);
  drawFitCircle(result.fit);
  showResult(result);
  recordResult(result);
  launchEmojiBurst(result.grade, getCanvasPoint(event));
};

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerCancel);

leaderboardBtn.addEventListener("click", () => {
  renderActiveLeaderboard();
  if (isRemoteEnabled()) {
    refreshRemoteLeaderboard();
  }
  openLeaderboard();
});

closeBoardBtn.addEventListener("click", () => closeLeaderboard());

clearBoardBtn.addEventListener("click", () => {
  const ok = window.confirm("确定清空本地缓存吗？不会影响联网排行榜。");
  if (!ok) return;
  localLeaderboard = [];
  saveLeaderboard(localLeaderboard);
  renderActiveLeaderboard();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && appEl.classList.contains("leaderboard-open")) {
    closeLeaderboard();
  }
});

resetBtn.addEventListener("click", () => resetAll());
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
