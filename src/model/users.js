const { Schema, model } = require("mongoose");

const Users = new Schema({
  chat_id: String,
  full_name: String,
  admin: {
    type: Boolean,
    default: false, // admin bormi
  },
  updateAt: Date,
  createdAt: Date,
});

module.exports = model("Users", Users);
