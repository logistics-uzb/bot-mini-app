const Users = require("../../model/users");
require("dotenv").config();

const BROADCAST_DELAY_MS = 50; // ~20 msg/sec, safely under Telegram's ~30/sec global limit.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const firstNameOf = (fullName) => {
  const trimmed = String(fullName || "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "";
};

const buildBroadcastText = (firstName) => {
  const salutation = firstName ? `Ассалому алайкум, ${firstName}! 👋` : "Ассалому алайкум! 👋";
  return `${salutation}

Қуйидаги тугма орқали мини-иловани очиб, мавжуд юклар билан танишишингиз мумкин.`;
};

const buildBroadcastKeyboard = () => ({
  inline_keyboard: [
    [
      {
        text: "🚚 Юкларни кўриш",
        web_app: { url: process.env.MINI_APP_URL },
      },
    ],
  ],
});

const sendOneWithRetry = async (bot, chatId, text, replyMarkup) => {
  try {
    await bot.sendMessage(chatId, text, { reply_markup: replyMarkup });
    return { ok: true };
  } catch (err) {
    const body = err.response?.body;
    if (body?.error_code === 429) {
      const waitMs = ((body.parameters?.retry_after || 1) * 1000) + 100;
      await sleep(waitMs);
      try {
        await bot.sendMessage(chatId, text, { reply_markup: replyMarkup });
        return { ok: true };
      } catch (retryErr) {
        return { ok: false, err: retryErr };
      }
    }
    return { ok: false, err };
  }
};

const sendBroadcast = async (bot, adminChatId) => {
  const users = await Users.find({ chat_id: { $exists: true, $ne: null } })
    .select("chat_id full_name")
    .lean();

  await bot.sendMessage(
    adminChatId,
    `📢 Yuborish boshlandi: ${users.length} ta foydalanuvchi.`
  );

  const keyboard = buildBroadcastKeyboard();
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.chat_id) continue;
    const text = buildBroadcastText(firstNameOf(user.full_name));
    const result = await sendOneWithRetry(bot, user.chat_id, text, keyboard);
    if (result.ok) {
      sent++;
    } else {
      failed++;
      const desc = result.err?.response?.body?.description || result.err?.message;
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

module.exports = { sendBroadcast };
