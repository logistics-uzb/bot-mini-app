const express = require("express");
const mongoose = require("mongoose");
const { CronJob } = require("cron");
const cron = require("cron");
const routes = require("./src/modules/routes");
const cors = require("cors"); // 🔥 CORS ni chaqirish
const errorHandler = require("./src/middleware/errorHandler");

require("dotenv").config();

const Users = require("./src/model/users");

require("./src/utils/cron");
const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  })
);

app.use(express.json());
app.use(routes);

require("./src/bot/bot");
app.use(errorHandler);

async function dev() {
  try {
    mongoose
      .connect(process.env.MONGO_URL, {
        useNewUrlParser: true,
      })
      .then(() => console.log("mongo connect"))
      .catch((error) => console.log(error.message));

    app.listen(process.env.PORT, () => {
      console.log("server is runing" + process.env.PORT);
    });

    // await updateAllOperatorsData();
  } catch (error) {
    console.log(error.message);
  }
}

dev();

app.get("/getAllUsers", async (req, res) => {
  const users = await Users.find().lean();
  res.json({
    message: "okk",
    users,
  });
});

app.get("/updateOperators", async (req, res) => {
  await updateAllOperatorsData();
  res.json({
    message: "update",
  });
});
