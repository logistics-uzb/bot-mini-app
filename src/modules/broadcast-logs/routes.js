const { Router } = require("express");
const controller = require("./broadcast-logs");

const broadcastLogsRoutes = Router();

broadcastLogsRoutes.get("/broadcast-logs/summary", controller.SUMMARY);
broadcastLogsRoutes.get("/broadcast-logs", controller.LIST);

module.exports = broadcastLogsRoutes;
