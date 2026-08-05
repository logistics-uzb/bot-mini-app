const Users = require("../../model/users");

const TZ_OFFSET_HOURS = 5; // Asia/Tashkent
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 60 * 60 * 1000;
const TZ_STRING = "+05:00";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const pad2 = (n) => String(n).padStart(2, "0");

const parseTs = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const asNum = Number(v);
  if (Number.isFinite(asNum) && String(asNum) === String(v).trim()) {
    return asNum;
  }
  const asDate = new Date(v).getTime();
  return Number.isFinite(asDate) ? asDate : null;
};

// Given a UTC ms, return the Tashkent-local bucket key.
const bucketKey = (utcMs, bucket) => {
  const t = new Date(utcMs + TZ_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = pad2(t.getUTCMonth() + 1);
  const d = pad2(t.getUTCDate());
  if (bucket === "hour") {
    const h = pad2(t.getUTCHours());
    return `${y}-${m}-${d}T${h}:00`;
  }
  return `${y}-${m}-${d}`;
};

// Snap UTC ms down to the start of its bucket (in Tashkent local time).
const bucketStartUtc = (utcMs, bucket) => {
  const step = bucket === "hour" ? HOUR_MS : DAY_MS;
  const localMs = utcMs + TZ_OFFSET_MS;
  const snapped = Math.floor(localMs / step) * step;
  return snapped - TZ_OFFSET_MS;
};

const enumerateBuckets = (fromUtc, toUtc, bucket) => {
  const step = bucket === "hour" ? HOUR_MS : DAY_MS;
  const keys = [];
  let cursor = bucketStartUtc(fromUtc, bucket);
  while (cursor < toUtc) {
    keys.push(bucketKey(cursor, bucket));
    cursor += step;
  }
  return keys;
};

const GET_USERS_TIMESERIES = async (req, res, next) => {
  try {
    const bucket = req.query.bucket === "hour" ? "hour" : "day";
    const fromMs = parseTs(req.query.from);
    const toMs = parseTs(req.query.to);

    if (fromMs === null || toMs === null) {
      return res.status(400).json({
        message: "`from` va `to` (ms yoki ISO date) majburiy",
      });
    }
    if (toMs <= fromMs) {
      return res.status(400).json({
        message: "`to` `from`dan katta bo'lishi kerak",
      });
    }

    const format = bucket === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";

    const grouped = await Users.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(fromMs), $lt: new Date(toMs) },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format,
              date: "$createdAt",
              timezone: TZ_STRING,
            },
          },
          users: { $sum: 1 },
        },
      },
    ]);

    const counts = new Map(grouped.map((g) => [g._id, g.users]));

    const data = enumerateBuckets(fromMs, toMs, bucket).map((date) => ({
      date,
      users: counts.get(date) || 0,
    }));

    res.json({
      bucket,
      timezone: "Asia/Tashkent",
      from: fromMs,
      to: toMs,
      total: data.reduce((s, p) => s + p.users, 0),
      data,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  GET_USERS_TIMESERIES,
};
