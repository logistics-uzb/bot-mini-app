const { Schema, model } = require("mongoose");

const Users = new Schema({
  chat_id: String,
  full_name: String,
  admin: {
    type: Boolean,
    default: false, // admin bormi
  },
  // Foydalanuvchi /start bosgach tanlagan rol.
  // Kelasi kirishlarda qayta so'ralmaydi. Statistika uchun ishlatiladi
  // (`/followers_type_result` buyrug'i).
  userType: {
    type: String,
    enum: [
      'dispatcher',      // Dispetcherman / Logistman
      'driver_fura',     // Haydovchiman - Fura
      'driver_chakman',  // Haydovchiman - Chakman
      'driver_isuzu',    // Haydovchiman - Isuzu
      'driver_labo',     // Haydovchiman - Labo
    ],
    default: null,
  },
  userTypeSetAt: Date,
  updateAt: Date,
  createdAt: Date,
});

module.exports = model("Users", Users);
