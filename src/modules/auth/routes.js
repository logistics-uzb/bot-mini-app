const { Router } = require("express");
const auth = require("./auth");
const verify = require("../../middleware/verify");


const authRoutes = Router();

authRoutes
  .get("/admin", auth.GET)
  .get("/me", verify, auth.GET_ME)
  .post("/login", auth.POST)
  .post("/register", auth.REGISTER);

module.exports = authRoutes;
