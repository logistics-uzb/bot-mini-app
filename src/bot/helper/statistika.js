const Users = require("../../model/users");
require("dotenv").config();

const TZ_OFFSET_HOURS = 5;
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const STATS_API_URL =
  process.env.STATS_API_URL ||
  "https://api.logistic-dev.coachingzona.uz/v1/stats/timeseries";
const STATS_API_PATH = process.env.STATS_API_PATH || "/v1/post/all";
const STATS_BUTTON_API_URL =
  process.env.STATS_BUTTON_API_URL ||
  "https://api.logistic-dev.coachingzona.uz/v1/stats/button-clicks";

const pad2 = (n) => String(n).padStart(2, "0");

// Today 00:00 → tomorrow 00:00 in Asia/Tashkent, returned as UTC ms.
// Future hour buckets (past "now") will simply show 0 counts.
const todayWindowUtcMs = () => {
  const nowTashkent = Date.now() + TZ_OFFSET_MS;
  const todayMidnightTashkent = Math.floor(nowTashkent / DAY_MS) * DAY_MS;
  const fromUtc = todayMidnightTashkent - TZ_OFFSET_MS;
  const toUtc = fromUtc + DAY_MS;
  return { fromUtc, toUtc };
};

const formatTashkentDate = (utcMs) => {
  const t = new Date(utcMs + TZ_OFFSET_MS);
  return `${pad2(t.getUTCDate())}.${pad2(
    t.getUTCMonth() + 1
  )}.${t.getUTCFullYear()}`;
};

const bucketByHour = (fromUtc, timestamps) => {
  const buckets = new Array(24).fill(0);
  for (const ms of timestamps) {
    const idx = Math.floor((ms - fromUtc) / HOUR_MS);
    if (idx >= 0 && idx < 24) buckets[idx]++;
  }
  return buckets;
};

const LABEL_WIDTH = 8; // "Umumiy:" (7) + trailing space.

const columnWidth = (values) =>
  Math.max(...values.map((v) => String(v).length), 1);

const buildRow = (label, values, widths) =>
  label.padEnd(LABEL_WIDTH) +
  values.map((v, i) => String(v).padStart(widths[i])).join(" - ");

const fetchClickBuckets = async (fromUtc, toUtc) => {
  const buckets = new Array(24).fill(0);
  const url =
    `${STATS_API_URL}?path=${encodeURIComponent(STATS_API_PATH)}` +
    `&method=GET&bucket=hour&from=${fromUtc}&to=${toUtc}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("stats API HTTP", resp.status, url);
      return { buckets, total: 0, ok: false };
    }
    const json = await resp.json();
    const points = json?.data?.points || [];
    for (const p of points) {
      const at = new Date(p.at).getTime();
      const idx = Math.floor((at - fromUtc) / HOUR_MS);
      if (idx >= 0 && idx < 24) buckets[idx] = Number(p.count) || 0;
    }
    const total = buckets.reduce((s, n) => s + n, 0);
    return { buckets, total, ok: true };
  } catch (e) {
    console.error("stats API fetch failed:", e.message);
    return { buckets, total: 0, ok: false };
  }
};

const fetchButtonClickBuckets = async (fromUtc, toUtc) => {
  const tgBuckets = new Array(24).fill(0);
  const callBuckets = new Array(24).fill(0);
  const url = `${STATS_BUTTON_API_URL}?bucket=hour&from=${fromUtc}&to=${toUtc}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("button-clicks API HTTP", resp.status, url);
      return { tgBuckets, callBuckets, tgTotal: 0, callTotal: 0, ok: false };
    }
    const json = await resp.json();
    const points = json?.data?.points || [];
    for (const p of points) {
      const at = new Date(p.at).getTime();
      const idx = Math.floor((at - fromUtc) / HOUR_MS);
      if (idx >= 0 && idx < 24) {
        tgBuckets[idx] = Number(p.tg) || 0;
        callBuckets[idx] = Number(p.call) || 0;
      }
    }
    const tgTotal = tgBuckets.reduce((s, n) => s + n, 0);
    const callTotal = callBuckets.reduce((s, n) => s + n, 0);
    return { tgBuckets, callBuckets, tgTotal, callTotal, ok: true };
  } catch (e) {
    console.error("button-clicks API fetch failed:", e.message);
    return { tgBuckets, callBuckets, tgTotal: 0, callTotal: 0, ok: false };
  }
};

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const sendStatistika = async (bot, chatId) => {
  const { fromUtc, toUtc } = todayWindowUtcMs();

  const [users, clicksResult, buttonsResult] = await Promise.all([
    Users.find({
      createdAt: { $gte: new Date(fromUtc), $lt: new Date(toUtc) },
    })
      .select("createdAt")
      .lean(),
    fetchClickBuckets(fromUtc, toUtc),
    fetchButtonClickBuckets(fromUtc, toUtc),
  ]);

  const userTimestamps = users
    .filter((u) => u.createdAt)
    .map((u) => new Date(u.createdAt).getTime());
  const userBuckets = bucketByHour(fromUtc, userTimestamps);
  const userTotal = userBuckets.reduce((s, n) => s + n, 0);

  const {
    buckets: clickBuckets,
    total: clickTotal,
    ok: clicksOk,
  } = clicksResult;

  const {
    tgBuckets,
    callBuckets,
    tgTotal,
    callTotal,
    ok: buttonsOk,
  } = buttonsResult;

  const errFlag = clicksOk && buttonsOk ? "" : " (API xatosi)";
  const dateStr = formatTashkentDate(fromUtc);

  const widths = [
    columnWidth([...userBuckets, userTotal]),
    columnWidth([...clickBuckets, clickTotal]),
    columnWidth([...tgBuckets, tgTotal]),
    columnWidth([...callBuckets, callTotal]),
  ];

  const rows = [buildRow("Soat:", ["F", "K", "T", "C"], widths)];
  for (let i = 0; i < 24; i++) {
    rows.push(
      buildRow(
        `${pad2(i)}-${pad2((i + 1) % 24)}:`,
        [userBuckets[i], clickBuckets[i], tgBuckets[i], callBuckets[i]],
        widths
      )
    );
  }
  rows.push(
    buildRow(
      "Umumiy:",
      [userTotal, clickTotal, tgTotal, callTotal],
      widths
    ) + errFlag
  );

  const body = `${dateStr} 📆\n\n${rows.join("\n")}`;

  await bot.sendMessage(chatId, `<pre>${escapeHtml(body)}</pre>`, {
    parse_mode: "HTML",
  });
};

module.exports = {
  sendStatistika,
};
