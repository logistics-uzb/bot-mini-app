const Users = require("../model/users");
const { bot } = require("./bot");
const { start } = require("./helper/start");

bot.on("message", async (msg) => {
  const chatId = msg.from.id;
  const text = msg.text;
  console.log("msg", msg);
  // const findUser = await Users.findOne({ chat_id: chatId }).lean();

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
