const { bot } = require("./bot");
const { isAllowedAdminUser } = require("./helper/admins");
const {
  pickType,
  confirmAndSend,
  cancelBroadcast,
  recordVote,
  showSurveyResults,
} = require("./helper/broadcast");

bot.on("callback_query", async (query) => {
  const chatId = query.from.id;
  const { data } = query;

  try {
    // Poll voting is user-facing: no admin gate, custom ack via recordVote.
    if (data && data.startsWith("bcast_vote_")) {
      const rest = data.slice("bcast_vote_".length);
      const li = rest.lastIndexOf("_");
      if (li < 0) return;
      const surveyId = rest.slice(0, li);
      const optionIdx = Number(rest.slice(li + 1));
      await recordVote(bot, query, surveyId, optionIdx);
      return;
    }

    bot
      .answerCallbackQuery(query.id)
      .catch((e) => console.log("answerCallbackQuery:", e.message));

    if (!isAllowedAdminUser(query.from.username)) return;

    if (
      data === "bcast_type_button" ||
      data === "bcast_type_plain" ||
      data === "bcast_type_poll"
    ) {
      const type = data.slice("bcast_type_".length);
      await pickType(bot, chatId, type);
      return;
    }
    if (data === "bcast_confirm") {
      await confirmAndSend(bot, chatId);
      return;
    }
    if (data === "bcast_cancel") {
      await cancelBroadcast(bot, chatId);
      return;
    }
    if (data && data.startsWith("bcast_result_")) {
      const surveyId = data.slice("bcast_result_".length);
      await showSurveyResults(bot, chatId, surveyId);
      return;
    }
  } catch (err) {
    console.error("callback failed:", err.message);
    await bot
      .sendMessage(chatId, `❌ Xatolik: ${err.message}`)
      .catch(() => {});
  }
});
