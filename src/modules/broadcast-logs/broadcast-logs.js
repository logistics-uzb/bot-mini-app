const BroadcastLog = require("../../model/broadcast-log");

/**
 * GET /v1/broadcast-logs
 * Filter va sahifalash bilan broadcast log yozuvlarini qaytaradi.
 *
 * Query params (barchasi optional):
 *   broadcastId   — bitta jo'natish sessiyasi (Survey._id yoki ObjectId)
 *   status        — "ok" | "error"
 *   category      — "blocked" | "deactivated" | "chat_not_found" | "rate_limit" | "other"
 *   type          — "button" | "plain" | "poll"
 *   userType      — "dispatcher" | "driver_fura" | "driver_chakman" | "driver_isuzu" | "driver_labo"
 *   chatId        — ma'lum foydalanuvchining log'lari
 *   from, to      — sana oralig'i (ISO string yoki YYYY-MM-DD)
 *   page          — default 1
 *   limit         — default 50, max 500
 */
async function LIST(req, res, next) {
  try {
    const {
      broadcastId,
      status,
      category,
      type,
      userType,
      chatId,
      from,
      to,
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(500, Math.max(1, Number(limit) || 50));

    const where = {};
    if (broadcastId) where.broadcastId = String(broadcastId);
    if (status) where.status = String(status);
    if (category) where.errorCategory = String(category);
    if (type) where.type = String(type);
    if (userType) where.userType = String(userType);
    if (chatId) where.chatId = String(chatId);
    if (from || to) {
      where.sentAt = {};
      if (from) where.sentAt.$gte = new Date(from);
      if (to) where.sentAt.$lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      BroadcastLog.find(where)
        .sort({ sentAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      BroadcastLog.countDocuments(where),
    ]);

    res.json({
      data,
      meta: { page: pageNum, limit: limitNum, total },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /v1/broadcast-logs/summary
 * Agregatsiya — statistika ko'rish uchun.
 * Query filtri LIST bilan bir xil (broadcastId, category, type, userType, ...)
 *
 * Chiqish:
 *   {
 *     total, ok, error,
 *     byCategory: { blocked: N, deactivated: N, chat_not_found: N, rate_limit: N, other: N },
 *     byUserType: { dispatcher: {ok, error}, driver_fura: {...}, ... }
 *   }
 */
async function SUMMARY(req, res, next) {
  try {
    const { broadcastId, type, userType, from, to } = req.query;

    const match = {};
    if (broadcastId) match.broadcastId = String(broadcastId);
    if (type) match.type = String(type);
    if (userType) match.userType = String(userType);
    if (from || to) {
      match.sentAt = {};
      if (from) match.sentAt.$gte = new Date(from);
      if (to) match.sentAt.$lte = new Date(to);
    }

    const rows = await BroadcastLog.aggregate([
      { $match: match },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          byCategory: [
            { $match: { status: "error" } },
            {
              $group: {
                _id: "$errorCategory",
                count: { $sum: 1 },
              },
            },
          ],
          byUserType: [
            {
              $group: {
                _id: { userType: "$userType", status: "$status" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const facet = rows[0] || { totals: [], byCategory: [], byUserType: [] };

    let ok = 0;
    let error = 0;
    for (const t of facet.totals) {
      if (t._id === "ok") ok = t.count;
      else if (t._id === "error") error = t.count;
    }

    const byCategory = {};
    for (const c of facet.byCategory) {
      byCategory[c._id || "unknown"] = c.count;
    }

    const byUserType = {};
    for (const u of facet.byUserType) {
      const ut = u._id.userType || "null";
      if (!byUserType[ut]) byUserType[ut] = { ok: 0, error: 0 };
      byUserType[ut][u._id.status] = u.count;
    }

    res.json({
      total: ok + error,
      ok,
      error,
      byCategory,
      byUserType,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { LIST, SUMMARY };
