const Users = require("../../model/users");
require("dotenv").config();

const BROADCAST_DELAY_MS = 50; // ~20 msg/sec, safely under Telegram's ~30/sec global limit.
const DRAFT_TTL_MS = 10 * 60 * 1000;

// Admins who typed /broadcast and are expected to send content next.
const awaitingMessage = new Set();
// adminChatId -> { fromChatId, messageId, createdAt }
const pendingDrafts = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clearExpiredDrafts = () => {
  const now = Date.now();
  for (const [key, draft] of pendingDrafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) pendingDrafts.delete(key);
  }
};

const buildMiniAppKeyboard = () => ({
  inline_keyboard: [
    [
      {
        text: "🚚 Юкларни кўриш",
        web_app: { url: process.env.MINI_APP_URL },
      },
    ],
  ],
});

const buildConfirmKeyboard = () => ({
  inline_keyboard: [
    [
      { text: "✅ Ha", callback_data: "broadcast_confirm" },
      { text: "❌ Yo'q", callback_data: "broadcast_cancel" },
    ],
  ],
});

const startBroadcast = async (bot, adminChatId) => {
  pendingDrafts.delete(adminChatId);
  awaitingMessage.add(adminChatId);
  await bot.sendMessage(
    adminChatId,
    "✍️ Yuboriladigan xabarni jo'nating (matn, rasm, video — istalgan format)."
  );
};

const isAwaitingBroadcast = (adminChatId) => awaitingMessage.has(adminChatId);

const captureDraftAndPreview = async (bot, adminChatId, msg) => {
  awaitingMessage.delete(adminChatId);
  pendingDrafts.set(adminChatId, {
    fromChatId: msg.chat.id,
    messageId: msg.message_id,
    createdAt: Date.now(),
  });

  try {
    await bot.copyMessage(adminChatId, msg.chat.id, msg.message_id, {
      reply_markup: buildMiniAppKeyboard(),
    });
  } catch (err) {
    console.error("preview copy failed:", err.message);
    pendingDrafts.delete(adminChatId);
    await bot.sendMessage(
      adminChatId,
      `❌ Ko'rsatishda xato: ${err.message}`
    );
    return;
  }

  await bot.sendMessage(adminChatId, "Xabarni tasdiqlaysizmi?", {
    reply_markup: buildConfirmKeyboard(),
  });
};

const copyOneWithRetry = async (
  bot,
  targetChatId,
  fromChatId,
  messageId,
  replyMarkup
) => {
  try {
    await bot.copyMessage(targetChatId, fromChatId, messageId, {
      reply_markup: replyMarkup,
    });
    return { ok: true };
  } catch (err) {
    const body = err.response?.body;
    if (body?.error_code === 429) {
      const waitMs = (body.parameters?.retry_after || 1) * 1000 + 100;
      await sleep(waitMs);
      try {
        await bot.copyMessage(targetChatId, fromChatId, messageId, {
          reply_markup: replyMarkup,
        });
        return { ok: true };
      } catch (retryErr) {
        return { ok: false, err: retryErr };
      }
    }
    return { ok: false, err };
  }
};

const confirmAndSend = async (bot, adminChatId) => {
  clearExpiredDrafts();
  const draft = pendingDrafts.get(adminChatId);
  if (!draft) {
    await bot.sendMessage(
      adminChatId,
      "⚠️ Xabar topilmadi yoki muddati o'tgan. /broadcast dan qayta boshlang."
    );
    return;
  }
  pendingDrafts.delete(adminChatId);

  const users = await Users.find({ chat_id: { $exists: true, $ne: null } })
    .select("chat_id")
    .lean();

  await bot.sendMessage(
    adminChatId,
    `📢 Yuborish boshlandi: ${users.length} ta foydalanuvchi.`
  );

  const keyboard = buildMiniAppKeyboard();
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.chat_id) continue;
    const result = await copyOneWithRetry(
      bot,
      user.chat_id,
      draft.fromChatId,
      draft.messageId,
      keyboard
    );
    if (result.ok) {
      sent++;
    } else {
      failed++;
      const desc =
        result.err?.response?.body?.description || result.err?.message;
      console.error(`broadcast to ${user.chat_id} failed:`, desc);
    }
    if (BROADCAST_DELAY_MS > 0) await sleep(BROADCAST_DELAY_MS);
  }

  await bot.sendMessage(
    adminChatId,
    `✅ Tugadi.
Yuborildi: ${sent}
Xatolik: ${failed}
Jami: ${users.length}`
  );
};

const cancelDraft = async (bot, adminChatId) => {
  awaitingMessage.delete(adminChatId);
  pendingDrafts.delete(adminChatId);
  await bot.sendMessage(adminChatId, "❌ Bekor qilindi.");
};

module.exports = {
  startBroadcast,
  isAwaitingBroadcast,
  captureDraftAndPreview,
  confirmAndSend,
  cancelDraft,
};
