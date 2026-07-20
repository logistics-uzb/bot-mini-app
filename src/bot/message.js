const Users = require("../model/users");
const { bot } = require("./bot");
const { start } = require("./helper/start");
const { isAllowedAdminUser } = require("./helper/admins");
const { sendStatistika } = require("./helper/statistika");
const {
  startBroadcast,
  isAwaitingBroadcast,
  captureDraftAndPreview,
} = require("./helper/broadcast");

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
    if (cmd === "/broadcast") {
      try {
        await startBroadcast(bot, chatId);
      } catch (err) {
        console.error("broadcast start failed:", err.message);
        await bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
      }
      return;
    }
    // If admin just typed /broadcast, the next message is the draft to preview.
    if (isAwaitingBroadcast(chatId)) {
      try {
        await captureDraftAndPreview(bot, chatId, msg);
      } catch (err) {
        console.error("broadcast preview failed:", err.message);
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
