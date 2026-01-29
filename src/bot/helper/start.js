const { bot } = require("../bot");
const Users = require("../../model/users");
require("dotenv").config();
const start = async (msg) => {
  const chatId = msg.from.id;
  const firstName = msg.from.first_name || "";

  let checkUser = await Users.findOne({ chat_id: chatId }).lean();
  // let checkUser = false;
  if (checkUser) {
    await bot.sendMessage(
      chatId,
      `Ассалому алайкум, ${firstName}! 👋

Қуйидаги тугма орқали мини-иловани очиб, мавжуд юклар билан танишишингиз мумкин.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚚 Юкларни кўриш",
                web_app: {
                  url: process.env.MINI_APP_URL,
                },
              },
            ],
          ],
          remove_keyboard: true,
        },
      }
    );
  } else if (!checkUser) {
    let newUser = new Users({
      chat_id: chatId,
      full_name: `${msg.from.first_name} ${msg.from.last_name || ""}`,
      admin: false,
      createdAt: new Date(),
    });
    await newUser.save();
    await bot.sendMessage(
      chatId,
      `Ассалому алайкум, ${firstName}! 👋

Қуйидаги тугма орқали мини-иловани очиб, мавжуд юклар билан танишишингиз мумкин.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚚 Юкларни кўриш",
                web_app: {
                  url: process.env.MINI_APP_URL,
                },
              },
            ],
          ],
          remove_keyboard: true,
        },
      }
    );
  }
};

module.exports = {
  start,
};
