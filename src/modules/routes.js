const express = require("express");
const auth = require("./auth/routes");


const router = express.Router();

router.use("/v1", auth, );

module.exports = router;


