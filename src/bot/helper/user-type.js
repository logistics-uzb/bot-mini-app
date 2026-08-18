/**
 * Foydalanuvchi roli (userType) tanlash flow'i:
 *  - /start bosilganda userType hali yo'q bo'lsa — 5 ta inline button
 *  - Foydalanuvchi tanlaganda callback → DB'ga saqlanadi + main menu ochiladi
 *  - Bir marta tanlaganda qayta so'ralmaydi
 *  - Admin `/followers_type_result` bilan taqsimlanish statistikasini ko'radi
 */
const Users = require("../../model/users");

const USER_TYPES = [
  { key: "dispatcher",     label: "1. Dispetcherman, Logistman" },
  { key: "driver_fura",    label: "2. Haydovchiman - Fura" },
  { key: "driver_chakman", label: "3. Haydovchiman - Chakman" },
  { key: "driver_isuzu",   label: "4. Haydovchiman - Isuzu" },
  { key: "driver_labo",    label: "5. Haydovchiman - Labo" },
];

// callback_data prefix — query.js shu bo'yicha yo'naltiradi.
const CB_PREFIX = "utype_";

const isUserTypeCallback = (data) =>
  typeof data === "string" && data.startsWith(CB_PREFIX);

/**
 * 5 ta inline button bilan rol tanlash so'rovi.
 * Foydalanuvchi kimligini (dispetchermi yoki haydovchi — qaysi transportda)
 * aniqlaymiz. Statistika va target auditoriya uchun.
 */
async function showTypePicker(bot, chatId) {
  const text =
    `👋 Assalomu alaykum!\n\n` +
    `📊 Quyidagilardan birini tanlang: 👇🏼`;

  await bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: USER_TYPES.map((t) => [
        { text: t.label, callback_data: CB_PREFIX + t.key },
      ]),
    },
  });
}

/**
 * Foydalanuvchi tanlagach chaqiriladi.
 *  - Birinchi tanlash: Users.userType saqlanadi, keyboard'da tanlanganga ✅ qo'shiladi,
 *    tugmalar o'chirilmaydi (foydalanuvchi o'z tanlovini ko'rib tursin).
 *  - Ikkinchi/keyingi bosishlar: userType allaqachon bor — hech nima o'zgarmaydi,
 *    faqat toast "Siz allaqachon tanladingiz: X" chiqadi.
 *
 * Return { ok: true, ... } — start.js showMainMenu chaqirilsin
 * Return { ok: false, alreadySet: true } — main menu qayta chiqmasin
 */
async function handleTypePick(bot, query) {
  const chatId = query.from.id;
  const key = String(query.data || "").slice(CB_PREFIX.length);
  const found = USER_TYPES.find((t) => t.key === key);

  if (!found) {
    await bot
      .answerCallbackQuery(query.id, { text: "Noto'g'ri tanlov" })
      .catch(() => {});
    return { ok: false };
  }

  const existing = await Users.findOne({ chat_id: chatId }).lean();

  // Allaqachon tanlangan — o'zgartirmaymiz, faqat toast bilan xabar
  if (existing?.userType) {
    const currentLabel =
      USER_TYPES.find((t) => t.key === existing.userType)?.label ??
      existing.userType;
    await bot
      .answerCallbackQuery(query.id, {
        text: `Siz allaqachon tanlagansiz: ${currentLabel.replace(/^\d+\.\s*/, "")}`,
        show_alert: false,
      })
      .catch(() => {});
    return { ok: false, alreadySet: true };
  }

  // Birinchi tanlash — DB'ga saqlash
  await Users.updateOne(
    { chat_id: chatId },
    {
      $set: {
        userType: found.key,
        userTypeSetAt: new Date(),
        full_name: `${query.from.first_name || ""} ${query.from.last_name || ""}`.trim(),
      },
      $setOnInsert: {
        chat_id: String(chatId),
        admin: false,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  await bot
    .answerCallbackQuery(query.id, {
      text: `✅ ${found.label.replace(/^\d+\.\s*/, "")}`,
    })
    .catch(() => {});

  // Tanlangan tugmaga ✅ prefix qo'shamiz, boshqa tugmalar o'zgarmaydi
  const updatedKeyboard = USER_TYPES.map((t) => [
    {
      text: t.key === found.key ? `✅ ${t.label}` : t.label,
      callback_data: CB_PREFIX + t.key,
    },
  ]);
  await bot
    .editMessageReplyMarkup(
      { inline_keyboard: updatedKeyboard },
      { chat_id: chatId, message_id: query.message.message_id },
    )
    .catch(() => {});

  return { ok: true, userType: found.key, label: found.label };
}

/**
 * Admin buyrug'i `/followers_type_result` uchun statistika.
 * Har bir userType bo'yicha % va son, sortlangan (kattadan kichikka).
 */
async function sendTypeResults(bot, chatId) {
  const [counts, totalWith, totalAll] = await Promise.all([
    Users.aggregate([
      { $match: { userType: { $ne: null } } },
      { $group: { _id: "$userType", count: { $sum: 1 } } },
    ]),
    Users.countDocuments({ userType: { $ne: null } }),
    Users.countDocuments({}),
  ]);

  const byKey = new Map(counts.map((c) => [c._id, c.count]));
  const untyped = totalAll - totalWith;

  const lines = ["📊 Foydalanuvchi turlari bo'yicha statistika:\n"];
  for (const t of USER_TYPES) {
    const c = byKey.get(t.key) || 0;
    const pct = totalWith > 0 ? Math.round((c / totalWith) * 100) : 0;
    lines.push(`${t.label} — ${c} (${pct}%)`);
  }

  lines.push("");
  lines.push(`Jami ovoz: ${totalWith}`);
  if (untyped > 0) {
    lines.push(`Tanlanmagan (eski foydalanuvchilar): ${untyped}`);
  }

  await bot.sendMessage(chatId, lines.join("\n"));
}

module.exports = {
  USER_TYPES,
  CB_PREFIX,
  isUserTypeCallback,
  showTypePicker,
  handleTypePick,
  sendTypeResults,
};
