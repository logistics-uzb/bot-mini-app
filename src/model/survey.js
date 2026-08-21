const { Schema, model } = require("mongoose");

// Poll uchun bitta ovoz. Bir chat_id bir marta ovoz beradi (revote update).
const VoteSchema = new Schema(
  {
    chat_id: String,
    full_name: String,
    option_idx: Number,
    votedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Question uchun bitta javob. Bir chat_id bir necha marta javob bera oladi —
// har yuborish yangi yozuv sifatida qo'shiladi (append, overwrite emas).
const AnswerSchema = new Schema(
  {
    chat_id: String,
    full_name: String,
    text: String,
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: true } // pagination va deduplikatsiya uchun _id kerak
);

/**
 * `Survey` — /broadcast oqimidan yaratilgan interaktiv xabarlar.
 *
 * type='poll'      — ko'p variantli so'rovnoma (options + votes)
 * type='question'  — ochiq javob so'rovi (text + answers[])
 *
 * Backward compat: type maydoni yo'q eski hujjatlar 'poll' deb hisoblanadi.
 */
const SurveySchema = new Schema({
  type: {
    type: String,
    enum: ["poll", "question"],
    default: "poll",
    index: true,
  },
  title: String, // poll: savol, question: prompt matni
  options: [String], // faqat poll
  votes: [VoteSchema], // faqat poll
  answers: [AnswerSchema], // faqat question — har javob alohida yozuv
  createdBy: String, // admin chat_id
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = model("Survey", SurveySchema);
