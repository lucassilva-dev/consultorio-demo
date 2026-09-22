const { config } = require("./config");
const { createExpressApp } = require("./routes");

function createApp(overrides = {}) {
  return createExpressApp(config, overrides);
}

module.exports = {
  createApp
};
