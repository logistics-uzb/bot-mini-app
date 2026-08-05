const STATISTICS_URL = "https://client-logistics.coachingzona.uz/statistics";

const CAPTION =
  "📊 <b>Статистика саҳифаси</b>\n\n" +
  "Ушбу саҳифада ботга қўшилган фойдаланувчилар сони, юк постлари ва " +
  "тугма босишлари бўйича батафсил статистикани кўра оласиз.\n\n" +
  "🕒 Кунлик ёки соатлик кесимда фильтрлаш мумкин.\n" +
  "📈 График ва жадвал шаклида кўрсатилади.\n\n" +
  "Қуйидаги тугмани босинг:";

const sendStatsPage = async (bot, chatId) => {
  await bot.sendMessage(chatId, CAPTION, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📊 Статистикани очиш",
            web_app: { url: STATISTICS_URL },
          },
        ],
      ],
    },
  });
};

module.exports = { sendStatsPage };
