const { bot } = require("./bot");
const { isAllowedAdminUser } = require("./helper/admins");
const { confirmAndSend, cancelDraft } = require("./helper/broadcast");

bot.on("callback_query", async (query) => {
  const chatId = query.from.id;
  const { data } = query;

  bot
    .answerCallbackQuery(query.id)
    .catch((e) => console.log("answerCallbackQuery:", e.message));

  if (!isAllowedAdminUser(query.from.username)) return;

  try {
    if (data === "broadcast_confirm") {
      await confirmAndSend(bot, chatId);
    } else if (data === "broadcast_cancel") {
      await cancelDraft(bot, chatId);
    }
  } catch (err) {
    console.error("broadcast callback failed:", err.message);
    await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
  }
});
