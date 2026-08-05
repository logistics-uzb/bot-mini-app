const { Schema, model } = require("mongoose");

const VoteSchema = new Schema(
  {
    chat_id: String,
    full_name: String,
    option_idx: Number,
    votedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SurveySchema = new Schema({
  title: String,
  options: [String],
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
  votes: [VoteSchema],
});

module.exports = model("Survey", SurveySchema);
