const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const BOT_TOKEN = process.env.TOKEN || process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;

if (!BOT_TOKEN) {
  throw new Error("BOT TOKEN is not defined");
}

if (!MINI_APP_URL) {
  throw new Error("MINI_APP_URL is not defined");
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true,
});

// =====================
// CHAT MENU BUTTON (MINI APP)
// =====================
// NOTE: the bot command menu AND the chat menu button are intentionally managed via BotFather,
// not from code. Do not re-enable `bot.setMyCommands` or `bot.setChatMenuButton`.
// (async () => {
//   try {
//     await bot.setChatMenuButton({
//       menu_button: {
//         type: "web_app",
//         text: "🚚 Юкларни кўриш",
//         web_app: {
//           url: MINI_APP_URL,
//         },
//       },
//     });
//     console.log("✅ Mini App menu button set successfully");
//   } catch (err) {
//     console.error("❌ Failed to set menu button:", err.message);
//   }
// })();

module.exports = {
  bot,
};

require("./message");
require("./query");
