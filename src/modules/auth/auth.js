const { Errorhandler } = require("../../exseptions/ErrorHandler");
const { sign } = require("../../utils/jwt");
const Users = require("../../model/users");

module.exports = {
  GET(req, res, next) {
    res.json("admin");
  },

  async GET_ME(req, res, next) {
    try {
    } catch (err) {
      next(err);
    }
  },

  async REGISTER(req, res, next) {
    try {
    } catch (error) {
      next(error);
    }
  },

  async POST(req, res, next) {
    try {
    } catch (error) {
      next(error);
    }
  },
};
