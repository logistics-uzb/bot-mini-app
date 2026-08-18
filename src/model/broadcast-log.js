const { Schema, model } = require("mongoose");

/**
 * Har broadcast jo'natish urinishi uchun bitta yozuv.
 * `broadcastId` — bitta jo'natish sessiyasi ichida barcha yozuvlar bir xil.
 * (Poll uchun Survey._id, boshqalarga admin generatsiya qilgan ObjectId.)
 *
 * Filter uchun optimizatsiya:
 *   { broadcastId, status } — bitta jo'natish natijalarini tez ko'rish
 *   { errorCategory }        — turli xato turlarini agregatsiya
 *   { chatId }               — ma'lum user'ning barcha jo'natishlari
 */
const BroadcastLog = new Schema({
  broadcastId: { type: String, index: true, required: true },
  type: {
    type: String,
    enum: ["button", "plain", "poll"],
    required: true,
  },
  chatId: { type: String, index: true, required: true },
  // Foydalanuvchi tanlagan rol (Users.userType) — jo'natish paytida snapshot
  userType: { type: String, default: null },
  status: {
    type: String,
    enum: ["ok", "error"],
    required: true,
    index: true,
  },
  // Xato bo'lsa Telegram API'dan kelgan raw kod (403, 400, 429 ...)
  errorCode: { type: Number, default: null },
  // Kategoriya — filter va hisobot uchun (blocked | deactivated | ...)
  errorCategory: { type: String, default: null, index: true },
  errorMessage: { type: String, default: null },
  sentAt: { type: Date, default: Date.now, index: true },
});

module.exports = model("BroadcastLog", BroadcastLog);
