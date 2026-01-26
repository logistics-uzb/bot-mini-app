const http = require("http");

module.exports = (err, _, res, __) => {
  if (process.env.NODE_ENV === "development") {
    return res.status(err.status || 500).json({
      message: err.message || "Something went wrong",
    });
  }

  if (process.env.NODE_ENV === "production") {
    return res.status(err.status || 500).json({
      message: http.STATUS_CODES[err.status] || "Internal Server Error",
    });
  }

  // fallback
  return res.status(500).json({
    message: "Unexpected error",
  });
};
