const express = require("express");
const auth = require("./auth/routes");
const stats = require("./stats/routes");
const broadcastLogs = require("./broadcast-logs/routes");


const router = express.Router();

router.use("/v1", auth);
router.use("/v1", stats);
router.use("/v1", broadcastLogs);

module.exports = router;


