const fs = require("fs");
const path = require("path");

module.exports = (baseDir) => {
  const resolveKey = (key) => {
    const full = path.resolve(baseDir, key);
    if (!full.startsWith(path.resolve(baseDir) + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return full;
  };

  return {
    name: "local",

    async put(localFile, key) {
      const target = resolveKey(key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.promises.rename(localFile, target);
      } catch (err) {
        if (err.code !== "EXDEV") throw err;
        await fs.promises.copyFile(localFile, target);
        await fs.promises.rm(localFile, { force: true });
      }
    },

    async get(key) {
      const file = resolveKey(key);
      const stat = await fs.promises.stat(file);
      return { stream: fs.createReadStream(file), size: stat.size };
    },

    async remove(key) {
      await fs.promises.rm(resolveKey(key), { force: true });
    },

    async check() {
      await fs.promises.mkdir(baseDir, { recursive: true });
      await fs.promises.access(baseDir, fs.constants.W_OK);
      return `Local disk (${baseDir})`;
    },
  };
};
