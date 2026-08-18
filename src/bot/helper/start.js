const { bot } = require("../bot");
const Users = require("../../model/users");
const { showTypePicker } = require("./user-type");
require("dotenv").config();

const DISPATCHER_URL = "https://yukchi-dispetcher.coachingzona.uz/auth";

/**
 * Yuklarni ko'rish + Dispetcher platformasi tugmalari bilan asosiy menyu.
 * userType tanlangan foydalanuvchilarga darhol chiqadi.
 * user-type.js dagi handleTypePick tanlashdan keyin ham shu funksiyani chaqiradi.
 */
async function showMainMenu(chatId, firstName) {
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
}

const start = async (msg) => {
  const chatId = msg.from.id;
  const firstName = msg.from.first_name || "";
  const fullName = `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();

  // Users upsert — mavjud bo'lsa userType saqlanadi
  const existing = await Users.findOneAndUpdate(
    { chat_id: chatId },
    {
      $set: { full_name: fullName },
      $setOnInsert: {
        chat_id: String(chatId),
        admin: false,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true },
  ).lean();

  // userType hali tanlanmagan bo'lsa — avval rol tanlash so'raymiz.
  // Tanlagach handleTypePick showMainMenu ni chaqiradi.
  if (!existing?.userType) {
    await showTypePicker(bot, chatId);
    return;
  }

  await showMainMenu(chatId, firstName);
};

module.exports = {
  start,
  showMainMenu,
};
