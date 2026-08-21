const mongoose = require("mongoose");
const Users = require("../../model/users");
const Survey = require("../../model/survey");
const BroadcastLog = require("../../model/broadcast-log");
require("dotenv").config();

/**
 * Telegram API xatosini kategoriyaga ajratadi.
 * Filterlash va agregatsiya uchun ishlatiladi (`GET /v1/broadcast-logs`).
 *
 * Kategoriyalar:
 *   blocked         — foydalanuvchi botni bloklagan (403)
 *   deactivated     — akkaunt o'chirilgan (403)
 *   chat_not_found  — chat_id mavjud emas (400)
 *   rate_limit      — 429 Too Many Requests
 *   other           — boshqa xato (network va h.k.)
 */
const categorizeBroadcastError = (err) => {
  const body = err?.response?.body;
  const code = body?.error_code ?? null;
  const desc = String(body?.description || err?.message || "");
  const low = desc.toLowerCase();

  let category = "other";
  if (code === 403 && low.includes("blocked")) category = "blocked";
  else if (code === 403 && low.includes("deactivated")) category = "deactivated";
  else if (code === 403) category = "blocked"; // ehtimol boshqa 403 — bloklash oilasi
  else if (
    code === 400 &&
    (low.includes("chat not found") || low.includes("peer_id_invalid"))
  ) {
    category = "chat_not_found";
  } else if (code === 429) category = "rate_limit";

  return { code, message: desc.slice(0, 500), category };
};

const BROADCAST_DELAY_MS = 50; // ~20 msg/sec, safely under Telegram's ~30/sec global limit.
// Batch rejim: har BROADCAST_BATCH_SIZE ta xabardan keyin BROADCAST_BATCH_PAUSE_MS ms kutamiz.
// Bu bloklash/rate-limit muammosini kamaytiradi (Telegram serverga "nafas olish" imkoni beradi).
// Hozirgi konfiguratsiya: ~8.6 msg/sec o'rtacha → 2900 user ~5.7 daqiqa.
const BROADCAST_BATCH_SIZE = 30;
const BROADCAST_BATCH_PAUSE_MS = 2000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_POLL_OPTIONS = 10;
const MIN_POLL_OPTIONS = 2;
const MAX_OPTION_LEN = 100;

// adminChatId -> {
//   step: 'awaiting_type' | 'awaiting_message' | 'awaiting_poll_title'
//        | 'awaiting_poll_option' | 'awaiting_question_text' | 'preview',
//   type: 'button' | 'plain' | 'poll' | 'question',
//   draft: { fromChatId, messageId } | null,
//   poll: { title, options: [] } | null,
//   question: { text } | null,
//   createdAt: number
// }
const sessions = new Map();

// User (regular, not admin) — "Javob yozish" bosgach javob yozishini kutmoqda.
// userChatId -> { questionId, createdAt }
// TTL: 30 daqiqa. Jarayonda user matn yuborsa → Answer sifatida saqlanadi.
const pendingAnswers = new Map();
const ANSWER_TTL_MS = 30 * 60 * 1000;

const clearExpiredAnswers = () => {
  const now = Date.now();
  for (const [key, s] of pendingAnswers) {
    if (now - s.createdAt > ANSWER_TTL_MS) pendingAnswers.delete(key);
  }
};

const isAwaitingAnswer = (chatId) => {
  clearExpiredAnswers();
  return pendingAnswers.has(chatId);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clearExpiredSessions = () => {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(key);
  }
};

const updateSession = (chatId, patch) => {
  const existing = sessions.get(chatId);
  if (!existing) return;
  sessions.set(chatId, { ...existing, ...patch });
};

const buildMiniAppKeyboard = () => ({
  inline_keyboard: [
    [
      {
        text: "🚚 Юкларни кўриш",
        web_app: { url: process.env.MINI_APP_URL },
      },
    ],
  ],
});

const buildConfirmKeyboard = () => ({
  inline_keyboard: [
    [
      { text: "✅ Ha", callback_data: "bcast_confirm" },
      { text: "❌ Yo'q", callback_data: "bcast_cancel" },
    ],
  ],
});

const buildTypePickKeyboard = () => ({
  inline_keyboard: [
    [
      {
        text: "🚚 \"Yuklarni ko'rish\" tugmasi bilan",
        callback_data: "bcast_type_button",
      },
    ],
    [{ text: "📝 Oddiy xabar", callback_data: "bcast_type_plain" }],
    [{ text: "📊 So'rovnoma", callback_data: "bcast_type_poll" }],
    [{ text: "❓ Savol-javob (foydalanuvchidan matnli javob)", callback_data: "bcast_type_question" }],
    [{ text: "❌ Bekor qilish", callback_data: "bcast_cancel" }],
  ],
});

// User xabarida "Javob yozish" tugmasi (bcast_answer_<questionId>)
const buildAnswerKeyboard = (questionId) => ({
  inline_keyboard: [
    [{ text: "✍️ Javob yozish", callback_data: `bcast_answer_${questionId}` }],
  ],
});

// User "Javob yozish" bosgach uchun ham cheklov: "Bekor qilish" tugmasi
const buildAnswerCancelKeyboard = () => ({
  inline_keyboard: [
    [{ text: "❌ Bekor qilish", callback_data: "bcast_answer_cancel" }],
  ],
});

const buildPollVoteKeyboard = (surveyId, options) => ({
  inline_keyboard: options.map((opt, i) => [
    {
      text: `${i + 1}. ${opt}`,
      callback_data: `bcast_vote_${surveyId}_${i}`,
    },
  ]),
});

const formatPollForUser = (title) => `📊 <b>${escapeHtml(title)}</b>`;

const formatPollResults = (title, options, counts) => {
  const total = counts.reduce((s, n) => s + n, 0);
  const lines = [`📊 <b>${escapeHtml(title)}</b>`, ""];
  options.forEach((opt, i) => {
    const c = counts[i] || 0;
    const pct = total > 0 ? Math.round((c / total) * 100) : 0;
    lines.push(`${i + 1}. ${escapeHtml(opt)} — <b>${c}</b> (${pct}%)`);
  });
  lines.push("", `Jami ovoz: <b>${total}</b>`);
  return lines.join("\n");
};

const startBroadcast = async (bot, adminChatId) => {
  sessions.set(adminChatId, {
    step: "awaiting_type",
    type: null,
    draft: null,
    poll: null,
    createdAt: Date.now(),
  });
  await bot.sendMessage(adminChatId, "📢 <b>Yuborish turini tanlang:</b>", {
    parse_mode: "HTML",
    reply_markup: buildTypePickKeyboard(),
  });
};

const isAwaitingBroadcast = (adminChatId) => {
  const s = sessions.get(adminChatId);
  if (!s) return false;
  return [
    "awaiting_message",
    "awaiting_poll_title",
    "awaiting_poll_option",
    "awaiting_question_text",
  ].includes(s.step);
};

const pickType = async (bot, adminChatId, type) => {
  clearExpiredSessions();
  const s = sessions.get(adminChatId);
  if (!s || s.step !== "awaiting_type") {
    await bot.sendMessage(
      adminChatId,
      "⚠️ Session topilmadi. /broadcast dan qayta boshlang."
    );
    return;
  }

  if (type === "poll") {
    updateSession(adminChatId, {
      step: "awaiting_poll_title",
      type,
      poll: { title: null, options: [] },
    });
    await bot.sendMessage(
      adminChatId,
      "📊 So'rovnoma <b>sarlavhasini</b> yuboring (faqat matn):",
      { parse_mode: "HTML" }
    );
    return;
  }

  if (type === "question") {
    updateSession(adminChatId, {
      step: "awaiting_question_text",
      type,
      question: { text: null },
    });
    await bot.sendMessage(
      adminChatId,
      "❓ Foydalanuvchilarga beriladigan savol matnini yuboring:\n\n" +
        "<i>Ular xabar tagidagi \"✍️ Javob yozish\" tugmasini bosib matnli javob yozishlari mumkin. " +
        "Bir foydalanuvchi bir necha marta javob yubora oladi — hammasi saqlanadi.</i>",
      { parse_mode: "HTML" }
    );
    return;
  }

  updateSession(adminChatId, { step: "awaiting_message", type });
  const hint =
    type === "button"
      ? "✍️ Yuboriladigan xabarni jo'nating (matn, rasm, video — istalgan format).\n\n<i>\"🚚 Юкларни кўриш\" tugmasi avtomatik qo'shiladi.</i>"
      : "✍️ Yuboriladigan oddiy xabarni jo'nating (matn, rasm, video — istalgan format).\n\n<i>Hech qanday tugma qo'shilmaydi.</i>";
  await bot.sendMessage(adminChatId, hint, { parse_mode: "HTML" });
};

const handleAdminInput = async (bot, adminChatId, msg) => {
  const s = sessions.get(adminChatId);
  if (!s) return;

  if (s.step === "awaiting_message") {
    return handleMessageDraft(bot, adminChatId, msg, s);
  }
  if (s.step === "awaiting_poll_title") {
    return handlePollTitle(bot, adminChatId, msg);
  }
  if (s.step === "awaiting_poll_option") {
    return handlePollOption(bot, adminChatId, msg, s);
  }
  if (s.step === "awaiting_question_text") {
    return handleQuestionText(bot, adminChatId, msg);
  }
};

// Question savol matnini qabul qiladi va preview + confirm ko'rsatadi.
const handleQuestionText = async (bot, adminChatId, msg) => {
  const text = (msg.text || "").trim();
  if (!text) {
    await bot.sendMessage(
      adminChatId,
      "❗️ Savol matn bo'lishi kerak (bo'sh emas). Qayta yuboring:"
    );
    return;
  }
  if (text.length > 1000) {
    await bot.sendMessage(
      adminChatId,
      "❗️ Savol matni 1000 belgidan uzun bo'lmasin. Qayta yuboring:"
    );
    return;
  }

  updateSession(adminChatId, {
    step: "preview",
    question: { text },
  });

  const preview = formatQuestionForUser(text);
  await bot.sendMessage(adminChatId, preview, {
    parse_mode: "HTML",
    reply_markup: buildAnswerKeyboard("preview"),
  });
  await bot.sendMessage(
    adminChatId,
    "📊 Ushbu savolni barcha foydalanuvchilarga yuboraylikmi?",
    { reply_markup: buildConfirmKeyboard() }
  );
};

const formatQuestionForUser = (text) =>
  `❓ <b>${escapeHtml(text)}</b>\n\n<i>Javob berish uchun quyidagi tugmani bosing.</i>`;

const handleMessageDraft = async (bot, adminChatId, msg, s) => {
  updateSession(adminChatId, {
    step: "preview",
    draft: { fromChatId: msg.chat.id, messageId: msg.message_id },
  });

  const keyboard = s.type === "button" ? buildMiniAppKeyboard() : undefined;

  try {
    await bot.copyMessage(adminChatId, msg.chat.id, msg.message_id, {
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("preview copy failed:", err.message);
    sessions.delete(adminChatId);
    await bot.sendMessage(adminChatId, `❌ Ko'rsatishda xato: ${err.message}`);
    return;
  }

  await bot.sendMessage(adminChatId, "Xabarni tasdiqlaysizmi?", {
    reply_markup: buildConfirmKeyboard(),
  });
};

const handlePollTitle = async (bot, adminChatId, msg) => {
  const text = (msg.text || "").trim();
  if (!text) {
    await bot.sendMessage(
      adminChatId,
      "❗️ Sarlavha faqat matn bo'lishi kerak. Qayta yuboring:"
    );
    return;
  }
  if (text.length > 200) {
    await bot.sendMessage(
      adminChatId,
      "❗️ Sarlavha 200 belgidan uzun bo'lmasin. Qayta yuboring:"
    );
    return;
  }
  updateSession(adminChatId, {
    step: "awaiting_poll_option",
    poll: { title: text, options: [] },
  });
  await bot.sendMessage(
    adminChatId,
    "1-variantni kiriting:\n\n<i>Har bir variantdan keyin keyingisini yuboring. " +
      `Kamida ${MIN_POLL_OPTIONS}, ko'pi bilan ${MAX_POLL_OPTIONS} variant. ` +
      "Tugatish uchun /done yozing.</i>",
    { parse_mode: "HTML" }
  );
};

const handlePollOption = async (bot, adminChatId, msg, s) => {
  const text = (msg.text || "").trim();

  if (text === "/done" || text === "done") {
    if (s.poll.options.length < MIN_POLL_OPTIONS) {
      await bot.sendMessage(
        adminChatId,
        `❗️ Kamida ${MIN_POLL_OPTIONS} variant kerak. Yana variant kiriting:`
      );
      return;
    }
    await showPollPreview(bot, adminChatId);
    return;
  }

  if (!text) {
    await bot.sendMessage(
      adminChatId,
      "❗️ Variant faqat matn bo'lishi kerak. Qayta yuboring:"
    );
    return;
  }
  if (text.length > MAX_OPTION_LEN) {
    await bot.sendMessage(
      adminChatId,
      `❗️ Variant ${MAX_OPTION_LEN} belgidan uzun bo'lmasin. Qayta yuboring:`
    );
    return;
  }

  const nextOptions = [...s.poll.options, text];
  updateSession(adminChatId, {
    poll: { ...s.poll, options: nextOptions },
  });

  if (nextOptions.length >= MAX_POLL_OPTIONS) {
    await bot.sendMessage(
      adminChatId,
      `✅ ${nextOptions.length}-variant qabul qilindi. Maksimum variantga yetdi.`
    );
    await showPollPreview(bot, adminChatId);
    return;
  }

  await bot.sendMessage(
    adminChatId,
    `✅ ${nextOptions.length}-variant qabul qilindi.\n\n` +
      `${nextOptions.length + 1}-variantni kiriting yoki /done yozing.`
  );
};

const showPollPreview = async (bot, adminChatId) => {
  const s = sessions.get(adminChatId);
  if (!s || !s.poll) return;
  updateSession(adminChatId, { step: "preview" });

  // Users only see title + vote buttons. Show admin the same preview.
  const preview = formatPollForUser(s.poll.title);
  const previewButtons = buildPollVoteKeyboard("preview", s.poll.options);

  await bot.sendMessage(adminChatId, preview, {
    parse_mode: "HTML",
    reply_markup: previewButtons,
  });
  await bot.sendMessage(
    adminChatId,
    `📊 Ushbu so'rovnoma <b>${s.poll.options.length} ta variant</b> bilan yuborilsinmi?`,
    {
      parse_mode: "HTML",
      reply_markup: buildConfirmKeyboard(),
    }
  );
};

const copyOneWithRetry = async (
  bot,
  targetChatId,
  fromChatId,
  messageId,
  replyMarkup
) => {
  const opts = replyMarkup ? { reply_markup: replyMarkup } : {};
  try {
    await bot.copyMessage(targetChatId, fromChatId, messageId, opts);
    return { ok: true };
  } catch (err) {
    const body = err.response?.body;
    if (body?.error_code === 429) {
      const waitMs = (body.parameters?.retry_after || 1) * 1000 + 100;
      await sleep(waitMs);
      try {
        await bot.copyMessage(targetChatId, fromChatId, messageId, opts);
        return { ok: true };
      } catch (retryErr) {
        return { ok: false, err: retryErr };
      }
    }
    return { ok: false, err };
  }
};

const sendOneWithRetry = async (bot, targetChatId, text, opts) => {
  try {
    await bot.sendMessage(targetChatId, text, opts);
    return { ok: true };
  } catch (err) {
    const body = err.response?.body;
    if (body?.error_code === 429) {
      const waitMs = (body.parameters?.retry_after || 1) * 1000 + 100;
      await sleep(waitMs);
      try {
        await bot.sendMessage(targetChatId, text, opts);
        return { ok: true };
      } catch (retryErr) {
        return { ok: false, err: retryErr };
      }
    }
    return { ok: false, err };
  }
};

const confirmAndSend = async (bot, adminChatId) => {
  clearExpiredSessions();
  const s = sessions.get(adminChatId);
  if (!s || s.step !== "preview") {
    await bot.sendMessage(
      adminChatId,
      "⚠️ Xabar topilmadi yoki muddati o'tgan. /broadcast dan qayta boshlang."
    );
    return;
  }

  const { type, draft, poll, question } = s;
  sessions.delete(adminChatId);

  // Barcha userlarni chat_id + userType bilan olamiz — log'da userType saqlanadi
  const users = await Users.find({ chat_id: { $exists: true, $ne: null } })
    .select("chat_id userType")
    .lean();

  await bot.sendMessage(
    adminChatId,
    `📢 Yuborish boshlandi: ${users.length} ta foydalanuvchi.`
  );

  let sent = 0;
  let failed = 0;

  // Har jo'natish sessiyasi uchun bir xil broadcastId — filter uchun kalit.
  // Poll uchun Survey._id, boshqalarga yangi ObjectId.
  let broadcastId;

  // Log yozuvlarini batch bilan saqlash (har bittasini alohida yozish sekin bo'ladi)
  const logBuffer = [];
  const flushLogs = async () => {
    if (logBuffer.length === 0) return;
    const batch = logBuffer.splice(0, logBuffer.length);
    try {
      await BroadcastLog.insertMany(batch, { ordered: false });
    } catch (e) {
      console.error("BroadcastLog insertMany failed:", e.message);
    }
  };

  const logAttempt = (user, res) => {
    const base = {
      broadcastId,
      type,
      chatId: String(user.chat_id),
      userType: user.userType ?? null,
      sentAt: new Date(),
    };
    if (res.ok) {
      logBuffer.push({ ...base, status: "ok" });
    } else {
      const cat = categorizeBroadcastError(res.err);
      logBuffer.push({
        ...base,
        status: "error",
        errorCode: cat.code,
        errorCategory: cat.category,
        errorMessage: cat.message,
      });
    }
    // Har 100 yozuvda flush
    if (logBuffer.length >= 100) return flushLogs();
  };

  if (type === "poll") {
    const survey = await Survey.create({
      title: poll.title,
      options: poll.options,
      createdBy: String(adminChatId),
      votes: [],
    });
    broadcastId = String(survey._id);
    const text = formatPollForUser(poll.title);
    const opts = {
      parse_mode: "HTML",
      reply_markup: buildPollVoteKeyboard(broadcastId, poll.options),
    };

    let processed = 0;
    for (const user of users) {
      if (!user.chat_id) continue;
      const res = await sendOneWithRetry(bot, user.chat_id, text, opts);
      if (res.ok) sent++;
      else {
        failed++;
        const desc = res.err?.response?.body?.description || res.err?.message;
        console.error(`poll to ${user.chat_id} failed:`, desc);
      }
      await logAttempt(user, res);
      processed++;
      // Har BROADCAST_BATCH_SIZE (30) ta xabardan keyin BROADCAST_BATCH_PAUSE_MS (5s) kutamiz
      if (processed % BROADCAST_BATCH_SIZE === 0) {
        await sleep(BROADCAST_BATCH_PAUSE_MS);
      } else if (BROADCAST_DELAY_MS > 0) {
        await sleep(BROADCAST_DELAY_MS);
      }
    }
  } else if (type === "question") {
    const survey = await Survey.create({
      type: "question",
      title: question.text,
      createdBy: String(adminChatId),
      answers: [],
    });
    broadcastId = String(survey._id);
    const text = formatQuestionForUser(question.text);
    const opts = {
      parse_mode: "HTML",
      reply_markup: buildAnswerKeyboard(broadcastId),
    };

    let processed = 0;
    for (const user of users) {
      if (!user.chat_id) continue;
      const res = await sendOneWithRetry(bot, user.chat_id, text, opts);
      if (res.ok) sent++;
      else {
        failed++;
        const desc = res.err?.response?.body?.description || res.err?.message;
        console.error(`question to ${user.chat_id} failed:`, desc);
      }
      await logAttempt(user, res);
      processed++;
      if (processed % BROADCAST_BATCH_SIZE === 0) {
        await sleep(BROADCAST_BATCH_PAUSE_MS);
      } else if (BROADCAST_DELAY_MS > 0) {
        await sleep(BROADCAST_DELAY_MS);
      }
    }
  } else {
    broadcastId = String(new mongoose.Types.ObjectId());
    const keyboard = type === "button" ? buildMiniAppKeyboard() : undefined;
    let processed = 0;
    for (const user of users) {
      if (!user.chat_id) continue;
      const res = await copyOneWithRetry(
        bot,
        user.chat_id,
        draft.fromChatId,
        draft.messageId,
        keyboard
      );
      if (res.ok) sent++;
      else {
        failed++;
        const desc = res.err?.response?.body?.description || res.err?.message;
        console.error(`broadcast to ${user.chat_id} failed:`, desc);
      }
      await logAttempt(user, res);
      processed++;
      // Har BROADCAST_BATCH_SIZE (30) ta xabardan keyin BROADCAST_BATCH_PAUSE_MS (5s) kutamiz
      if (processed % BROADCAST_BATCH_SIZE === 0) {
        await sleep(BROADCAST_BATCH_PAUSE_MS);
      } else if (BROADCAST_DELAY_MS > 0) {
        await sleep(BROADCAST_DELAY_MS);
      }
    }
  }

  // Oxirgi partiyani yozamiz
  await flushLogs();

  await bot.sendMessage(
    adminChatId,
    `✅ Tugadi.
Yuborildi: ${sent}
Xatolik: ${failed}
Jami: ${users.length}

📋 Broadcast ID: <code>${broadcastId}</code>
Batafsil: <code>GET /v1/broadcast-logs?broadcastId=${broadcastId}</code>`,
    { parse_mode: "HTML" }
  );
};

const cancelBroadcast = async (bot, adminChatId) => {
  sessions.delete(adminChatId);
  await bot.sendMessage(adminChatId, "❌ Bekor qilindi.");
};

const recordVote = async (bot, query, surveyId, optionIdx) => {
  if (surveyId === "preview") {
    await bot
      .answerCallbackQuery(query.id, {
        text: "Bu preview — hali yuborilmagan",
      })
      .catch(() => {});
    return;
  }
  const survey = await Survey.findById(surveyId).catch(() => null);
  if (!survey) {
    await bot
      .answerCallbackQuery(query.id, {
        text: "So'rovnoma topilmadi",
        show_alert: true,
      })
      .catch(() => {});
    return;
  }
  if (
    !Number.isInteger(optionIdx) ||
    optionIdx < 0 ||
    optionIdx >= survey.options.length
  ) {
    await bot
      .answerCallbackQuery(query.id, {
        text: "Noto'g'ri variant",
        show_alert: true,
      })
      .catch(() => {});
    return;
  }

  const userId = String(query.from.id);
  const fullName =
    [query.from.first_name, query.from.last_name].filter(Boolean).join(" ") ||
    query.from.username ||
    userId;

  const existing = survey.votes.find((v) => v.chat_id === userId);
  let feedback;
  if (existing) {
    if (existing.option_idx === optionIdx) {
      await bot
        .answerCallbackQuery(query.id, { text: "✅ Ovozingiz saqlangan" })
        .catch(() => {});
      return;
    }
    existing.option_idx = optionIdx;
    existing.votedAt = new Date();
    feedback = `✏️ Ovoz o'zgartirildi: ${survey.options[optionIdx]}`;
  } else {
    survey.votes.push({
      chat_id: userId,
      full_name: fullName,
      option_idx: optionIdx,
      votedAt: new Date(),
    });
    feedback = `✅ Ovoz qabul qilindi: ${survey.options[optionIdx]}`;
  }
  await survey.save();
  await bot
    .answerCallbackQuery(query.id, { text: feedback })
    .catch(() => {});
};

const listSurveys = async (bot, chatId) => {
  const surveys = await Survey.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .select("title createdAt votes answers type")
    .lean();

  if (surveys.length === 0) {
    await bot.sendMessage(
      chatId,
      "So'rovnomalar hali yaratilmagan. /broadcast → 📊 So'rovnoma yoki ❓ Savol."
    );
    return;
  }

  const keyboard = surveys.map((s) => {
    const date = new Date(s.createdAt);
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const type = s.type || "poll";
    const count = type === "question" ? (s.answers?.length || 0) : (s.votes?.length || 0);
    const suffix = type === "question" ? "javob" : "ovoz";
    const icon = type === "question" ? "❓" : "📊";
    const label = `${icon} ${dd}.${mm} · ${count} ${suffix} · ${(s.title || "").slice(0, 40)}`;
    return [{ text: label, callback_data: `bcast_result_${s._id}` }];
  });

  await bot.sendMessage(chatId, "📋 So'rovnoma yoki savoldan birini tanlang:", {
    reply_markup: { inline_keyboard: keyboard },
  });
};

// Question uchun sahifadagi javob soni
const ANSWERS_PAGE_SIZE = 5;

const showSurveyResults = async (bot, chatId, surveyId, page = 1) => {
  const survey = await Survey.findById(surveyId).lean().catch(() => null);
  if (!survey) {
    await bot.sendMessage(chatId, "❌ So'rovnoma topilmadi.");
    return;
  }

  const type = survey.type || "poll";

  if (type === "question") {
    await renderQuestionResults(bot, chatId, survey, page);
    return;
  }

  // Poll — hozirgi kabi
  const counts = survey.options.map(() => 0);
  for (const v of survey.votes || []) {
    if (
      Number.isInteger(v.option_idx) &&
      v.option_idx >= 0 &&
      v.option_idx < counts.length
    ) {
      counts[v.option_idx]++;
    }
  }

  const createdStr = new Date(survey.createdAt).toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
  });
  const text =
    formatPollResults(survey.title, survey.options, counts) +
    `\n\n🕒 Yaratilgan: <i>${escapeHtml(createdStr)}</i>`;

  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
};

// Question javoblarini sahifalab ko'rsatish.
// Sahifada 5 ta javob, Prev/Next inline button'lar bilan.
const renderQuestionResults = async (bot, chatId, survey, page) => {
  const answers = (survey.answers || []).slice().sort((a, b) =>
    // Eng yangi javob eng yuqorida
    new Date(b.answeredAt) - new Date(a.answeredAt),
  );
  const total = answers.length;
  const pageSize = ANSWERS_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, pageCount));
  const start = (safePage - 1) * pageSize;
  const slice = answers.slice(start, start + pageSize);

  const createdStr = new Date(survey.createdAt).toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
  });

  const header = `❓ <b>${escapeHtml(survey.title)}</b>\n\n`;
  const stats = `<b>Jami javoblar:</b> ${total}` +
    (total > 0 ? `  ·  <b>Sahifa:</b> ${safePage}/${pageCount}` : "");
  const footer = `\n\n🕒 Yaratilgan: <i>${escapeHtml(createdStr)}</i>`;

  let body = "";
  if (total === 0) {
    body = "\n<i>Hali hech kim javob yubormagan.</i>";
  } else {
    body = "\n\n" + slice.map((a, i) => {
      const num = start + i + 1;
      const when = new Date(a.answeredAt).toLocaleString("uz-UZ", {
        timeZone: "Asia/Tashkent",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const who = escapeHtml(a.full_name || `chat ${a.chat_id}`);
      // Javob matni Telegram blockquote'da — o'zi ajralib turadi.
      // `expandable` — uzun matn tugatilib "Show more" tugmasi bilan yig'iladi.
      const txt = escapeHtml(a.text || "");
      return `<b>${num}. ${who}</b>  <i>[${when}]</i>\n<blockquote expandable>${txt}</blockquote>`;
    }).join("\n\n");
  }

  const text = header + stats + body + footer;

  // Pagination tugmalari (agar sahifa 1 dan ko'p bo'lsa)
  const navButtons = [];
  if (safePage > 1) {
    navButtons.push({
      text: "◀️ Oldingi",
      callback_data: `bcast_result_${survey._id}_p${safePage - 1}`,
    });
  }
  if (safePage < pageCount) {
    navButtons.push({
      text: "Keyingi ▶️",
      callback_data: `bcast_result_${survey._id}_p${safePage + 1}`,
    });
  }
  const reply_markup =
    navButtons.length > 0 ? { inline_keyboard: [navButtons] } : undefined;

  await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup });
};

// User "Javob yozish" bosgach chaqiriladi.
// Foydalanuvchini javob yozish holatiga o'tkazadi va prompt yuboradi.
const startAnswer = async (bot, query, questionId) => {
  const chatId = query.from.id;

  // Survey mavjudmi va question turida ekanini tekshiramiz
  const survey = await Survey.findById(questionId)
    .select("type title")
    .lean()
    .catch(() => null);
  if (!survey || survey.type !== "question") {
    await bot
      .answerCallbackQuery(query.id, { text: "❌ Savol topilmadi." })
      .catch(() => {});
    return;
  }

  pendingAnswers.set(chatId, { questionId, createdAt: Date.now() });

  await bot
    .answerCallbackQuery(query.id, { text: "✍️ Javob kutmoqda..." })
    .catch(() => {});

  await bot.sendMessage(
    chatId,
    `❓ <b>${escapeHtml(survey.title)}</b>\n\n` +
      `Iltimos, javobingizni matn shaklida yuboring (bitta xabar). ` +
      `Xohlagancha javob yubora olasiz — hammasi saqlanadi.`,
    {
      parse_mode: "HTML",
      reply_markup: buildAnswerCancelKeyboard(),
    },
  );
};

// User "Bekor qilish" bosgach chaqiriladi
const cancelAnswer = async (bot, query) => {
  const chatId = query.from.id;
  pendingAnswers.delete(chatId);
  await bot
    .answerCallbackQuery(query.id, { text: "Bekor qilindi." })
    .catch(() => {});
  await bot.sendMessage(chatId, "✅ Javob yuborish bekor qilindi.");
};

// User javob yozganda (matn xabar) chaqiriladi.
// message.js dan intercept qilinadi: agar isAwaitingAnswer(chatId) rost bo'lsa.
const recordAnswer = async (bot, msg) => {
  const chatId = msg.from.id;
  const session = pendingAnswers.get(chatId);
  if (!session) return false;

  const text = (msg.text || "").trim();
  if (!text) {
    await bot.sendMessage(
      chatId,
      "❗️ Faqat matnli javob qabul qilinadi. Rasm/video yubormang.",
    );
    return true; // handled (don't fall through to /start)
  }
  if (text.length > 2000) {
    await bot.sendMessage(
      chatId,
      "❗️ Javob 2000 belgidan uzun bo'lmasin. Qayta yuboring:",
    );
    return true;
  }

  try {
    await Survey.updateOne(
      { _id: session.questionId },
      {
        $push: {
          answers: {
            chat_id: String(chatId),
            full_name: `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim(),
            text,
            answeredAt: new Date(),
          },
        },
      },
    );

    pendingAnswers.delete(chatId);

    await bot.sendMessage(
      chatId,
      "✅ Javobingiz saqlandi. Rahmat!\n\n<i>Yana javob qo'shmoqchi bo'lsangiz, savol xabaridagi \"✍️ Javob yozish\" tugmasini qayta bosing.</i>",
      { parse_mode: "HTML" },
    );
  } catch (err) {
    console.error("recordAnswer failed:", err.message);
    await bot.sendMessage(
      chatId,
      "❌ Javobni saqlashda xato yuz berdi. Qayta urunib ko'ring.",
    );
  }

  return true;
};

module.exports = {
  startBroadcast,
  isAwaitingBroadcast,
  handleAdminInput,
  pickType,
  confirmAndSend,
  cancelBroadcast,
  recordVote,
  listSurveys,
  showSurveyResults,
  startAnswer,
  cancelAnswer,
  recordAnswer,
  isAwaitingAnswer,
};
