const config = require("../../config");

const create = () => {
  switch (config.storage.driver) {
    case "local":
      return require("./local")(config.storage.localDir);
    case "s3":
      return require("./s3")(config.storage.s3);
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${config.storage.driver}" (use "local" or "s3")`);
  }
};

module.exports = create();
