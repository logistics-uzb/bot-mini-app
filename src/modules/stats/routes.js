const { Router } = require("express");
const stats = require("./stats");

const statsRoutes = Router();

statsRoutes.get("/stats/users", stats.GET_USERS_TIMESERIES);

module.exports = statsRoutes;
