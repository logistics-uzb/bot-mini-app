const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

const sign = (payload) => jwt.sign(payload, process.env.SECRET_KEY);

module.exports = { sign };
