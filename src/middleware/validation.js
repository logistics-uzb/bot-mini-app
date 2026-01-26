const { Errorhandler } = require("../exseptions/ErrorHandler");

module.exports = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);

    if (error) {
      return next(new Errorhandler(error.message, 400));
    }

    req.filtered = value;
    next();
  };
};
