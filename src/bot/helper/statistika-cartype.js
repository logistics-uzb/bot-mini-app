/**
 * `/statshoutbycartype` buyrug'i — vehicleType bo'yicha soatlik statistika.
 * Har soat uchun 5 ustun: AC / AV / F / I / Ch.
 *
 * AC = jami call-button click (barcha post)
 * AV = jami view-button click (barcha post)
 * F  = tent ("fura") turdagi post'larga bosilgan hamma click (tg+call+view)
 * I  = isuzu turdagi post'larga bosilgan hamma click
 * Ch = chakman turdagi post'larga bosilgan hamma click
 *
 * Backend endpoint: GET /v1/stats/button-clicks-by-vehicle-type?bucket=hour&from=&to=
 * Response shape: { status_code, data: { points: [{ at, ac, av, fura, isuzu, chakman }], totals: {...} } }
 */
require("dotenv").config();

const TZ_OFFSET_HOURS = 5;
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const STATS_BY_VEHICLE_URL =
  process.env.STATS_BY_VEHICLE_URL ||
  "https://api.logistic-dev.coachingzona.uz/v1/stats/button-clicks-by-vehicle-type";

const pad2 = (n) => String(n).padStart(2, "0");

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

const LABEL_WIDTH = 8; // "Umumiy:" (7) + trailing space.
const columnWidth = (values) =>
  Math.max(...values.map((v) => String(v).length), 1);

const buildRow = (label, values, widths) =>
  label.padEnd(LABEL_WIDTH) +
  values.map((v, i) => String(v).padEnd(widths[i])).join(" - ");

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Backend'dan 24 ta soatlik bucket olib keladi va 5 ta massivga ajratadi.
 * API xato bo'lsa hamma nolli array + ok:false qaytaradi (buyruq buzulmasin).
 */
const fetchBuckets = async (fromUtc, toUtc) => {
  const ac = new Array(24).fill(0);
  const av = new Array(24).fill(0);
  const fura = new Array(24).fill(0);
  const isuzu = new Array(24).fill(0);
  const chakman = new Array(24).fill(0);

  const url = `${STATS_BY_VEHICLE_URL}?bucket=hour&from=${fromUtc}&to=${toUtc}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("cartype API HTTP", resp.status, url);
      return { ac, av, fura, isuzu, chakman, ok: false };
    }
    const json = await resp.json();
    const points = json?.data?.points || [];
    for (const p of points) {
      const at = new Date(p.at).getTime();
      const idx = Math.floor((at - fromUtc) / HOUR_MS);
      if (idx < 0 || idx >= 24) continue;
      ac[idx] = Number(p.ac) || 0;
      av[idx] = Number(p.av) || 0;
      fura[idx] = Number(p.fura) || 0;
      isuzu[idx] = Number(p.isuzu) || 0;
      chakman[idx] = Number(p.chakman) || 0;
    }
    return { ac, av, fura, isuzu, chakman, ok: true };
  } catch (e) {
    console.error("cartype API fetch failed:", e.message);
    return { ac, av, fura, isuzu, chakman, ok: false };
  }
};

const sendStatsByCartype = async (bot, chatId) => {
  const { fromUtc, toUtc } = todayWindowUtcMs();
  const {
    ac,
    av,
    fura,
    isuzu,
    chakman,
    ok,
  } = await fetchBuckets(fromUtc, toUtc);

  const sum = (arr) => arr.reduce((s, n) => s + n, 0);
  const totalAc = sum(ac);
  const totalAv = sum(av);
  const totalF = sum(fura);
  const totalI = sum(isuzu);
  const totalCh = sum(chakman);

  const errFlag = ok ? "" : " (API xatosi)";
  const dateStr = formatTashkentDate(fromUtc);

  const widths = [
    columnWidth([...ac, totalAc]),
    columnWidth([...av, totalAv]),
    columnWidth([...fura, totalF]),
    columnWidth([...isuzu, totalI]),
    columnWidth([...chakman, totalCh]),
  ];

  const rows = [buildRow("Soat:", ["AC", "AV", "F", "I", "Ch"], widths)];
  for (let i = 0; i < 24; i++) {
    rows.push(
      buildRow(
        `${pad2(i)}-${pad2((i + 1) % 24)}:`,
        [ac[i], av[i], fura[i], isuzu[i], chakman[i]],
        widths
      )
    );
  }
  rows.push(
    buildRow(
      "Umumiy:",
      [totalAc, totalAv, totalF, totalI, totalCh],
      widths
    ) + errFlag
  );

  const body = `${dateStr} 📆\n\n${rows.join("\n")}`;
  await bot.sendMessage(chatId, `<pre>${escapeHtml(body)}</pre>`, {
    parse_mode: "HTML",
  });
};

module.exports = { sendStatsByCartype };
