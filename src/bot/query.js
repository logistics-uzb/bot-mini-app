const { bot } = require("./bot");
const { isAllowedAdminUser } = require("./helper/admins");
const {
  pickType,
  confirmAndSend,
  cancelBroadcast,
  recordVote,
  showSurveyResults,
  startAnswer,
  cancelAnswer,
} = require("./helper/broadcast");
const { isUserTypeCallback, handleTypePick } = require("./helper/user-type");
const { showMainMenu } = require("./helper/start");

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

    // Question "Javob yozish" — user-facing, admin gate yo'q, o'zi ack qiladi
    if (data && data.startsWith("bcast_answer_")) {
      const rest = data.slice("bcast_answer_".length);
      if (rest === "cancel") {
        await cancelAnswer(bot, query);
        return;
      }
      await startAnswer(bot, query, rest);
      return;
    }

    // User type picker — user-facing, admin gate yo'q, o'zi ack qiladi
    if (isUserTypeCallback(data)) {
      const result = await handleTypePick(bot, query);
      if (result.ok) {
        // Rol saqlangach darhol main menu ko'rsatamiz
        await showMainMenu(chatId, query.from.first_name || "");
      }
      return;
    }

    bot
      .answerCallbackQuery(query.id)
      .catch((e) => console.log("answerCallbackQuery:", e.message));

    if (!isAllowedAdminUser(query.from.username)) return;

    if (
      data === "bcast_type_button" ||
      data === "bcast_type_plain" ||
      data === "bcast_type_poll" ||
      data === "bcast_type_question"
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
    // bcast_result_<surveyId>       — 1-sahifa
    // bcast_result_<surveyId>_p<N>  — N-sahifa (faqat question turi uchun)
    if (data && data.startsWith("bcast_result_")) {
      const rest = data.slice("bcast_result_".length);
      const pageMatch = rest.match(/^(.+?)_p(\d+)$/);
      if (pageMatch) {
        const surveyId = pageMatch[1];
        const page = Number(pageMatch[2]);
        await showSurveyResults(bot, chatId, surveyId, page);
      } else {
        await showSurveyResults(bot, chatId, rest, 1);
      }
      return;
    }
  } catch (err) {
    console.error("callback failed:", err.message);
    await bot
      .sendMessage(chatId, `❌ Xatolik: ${err.message}`)
      .catch(() => {});
  }
});
