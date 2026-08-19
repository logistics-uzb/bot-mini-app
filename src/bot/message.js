const Users = require("../model/users");
const { bot } = require("./bot");
const { start } = require("./helper/start");
const { isAllowedAdminUser } = require("./helper/admins");
const { sendStatistika } = require("./helper/statistika");
const { sendStatsByCartype } = require("./helper/statistika-cartype");
const { sendStatsPage } = require("./helper/statspage");
const {
  startBroadcast,
  isAwaitingBroadcast,
  handleAdminInput,
  listSurveys,
} = require("./helper/broadcast");
const { sendTypeResults } = require("./helper/user-type");

bot.on("message", async (msg) => {
  const chatId = msg.from.id;
  const text = msg.text || "";
  console.log("msg", msg);

  // Hidden admin commands: only authorised users trigger them; anyone else falls through to start().
  const cmd = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  if (isAllowedAdminUser(msg.from.username)) {
    if (cmd === "/statshour") {
      try {
        await sendStatistika(bot, chatId);
      } catch (err) {
        console.error("statistika failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    if (cmd === "/statshoutbycartype") {
      try {
        await sendStatsByCartype(bot, chatId);
      } catch (err) {
        console.error("statshoutbycartype failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    if (cmd === "/statspage") {
      try {
        await sendStatsPage(bot, chatId);
      } catch (err) {
        console.error("statspage failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    if (cmd === "/broadcast") {
      try {
        await startBroadcast(bot, chatId);
      } catch (err) {
        console.error("broadcast start failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    if (cmd === "/broadcast_results" || cmd === "/broadcast-results") {
      try {
        await listSurveys(bot, chatId);
      } catch (err) {
        console.error("broadcast_results failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    if (cmd === "/followers_type_result") {
      try {
        await sendTypeResults(bot, chatId);
      } catch (err) {
        console.error("followers_type_result failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    // After /broadcast, admin sends message / poll title / poll option.
    if (isAwaitingBroadcast(chatId)) {
      try {
        await handleAdminInput(bot, chatId, msg);
      } catch (err) {
        console.error("broadcast input failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
  }

  const findUser = await Users.findOne({ chat_id: chatId }).lean();

  // if (text == "/start" || text == "🔙 Menu") {
  console.log("start command received");
  start(msg);
  // } else {
  //   await bot.sendMessage(
  //     chatId,
  //     `❌ Нотўғри буйруқ киритилди.

  // Илтимос, /start буйруғини юборинг.`
  //   );
  // }
});
