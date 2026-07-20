const { bot } = require("../bot");
const Users = require("../../model/users");
require("dotenv").config();

const DISPATCHER_URL = "https://yukchi-dispetcher.coachingzona.uz/auth";

const start = async (msg) => {
  const chatId = msg.from.id;
  const firstName = msg.from.first_name || "";

  const checkUser = await Users.findOne({ chat_id: chatId }).lean();
  if (!checkUser) {
    await new Users({
      chat_id: chatId,
      full_name: `${msg.from.first_name} ${msg.from.last_name || ""}`,
      admin: false,
      createdAt: new Date(),
    }).save();
  }

  const greeting = `Ассалому алайкум, ${firstName}! 👋

Қуйидаги тугма орқали мини-иловани очиб, мавжуд юклар билан танишишингиз мумкин.`;

  await bot.sendMessage(chatId, greeting, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚚 Юкларни кўриш",
            web_app: { url: process.env.MINI_APP_URL },
          },
        ],
        [
          {
            text: "🧭 Диспетчер платформаси",
            web_app: { url: DISPATCHER_URL },
          },
        ],
      ],
    },
  });
};

module.exports = {
  start,
};
