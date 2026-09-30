const fs = require("fs");
const path = require("path");
const { postgresDir, sqlDir, successLogFunc } = require("./directories.js");
const successLog = successLogFunc();
const postgreDumpFolder = postgresDir();
const sqlDumpFolder = sqlDir();

const deleteFolderPostgres = async () => {
  const postgreDump = await fs.promises.readdir(postgreDumpFolder);
  if (postgreDump.length > 7) {
    const oldestFolder = postgreDump[0];
    const oldestFolderPath = path.join(postgreDumpFolder, oldestFolder);
    await fs.promises.rm(oldestFolderPath, { recursive: true });
    console.log(`Database folder deleted: ${oldestFolderPath}`);
    fs.appendFileSync(
      successLog,
      `Database folder deleted: ${oldestFolderPath}\n`
    );
    return;
  }
};

const deleteFolderSql = async () => {
  const sqlDump = await fs.promises.readdir(sqlDumpFolder);

  if (sqlDump.length > 7) {
    const oldestFolder = sqlDump[0];
    const oldestFolderPath = path.join(sqlDumpFolder, oldestFolder);
    await fs.promises.rm(oldestFolderPath, { recursive: true });
    console.log(`Database folder deleted: ${oldestFolderPath}`);
    fs.appendFileSync(
      successLog,
      `Database folder deleted: ${oldestFolderPath}\n`
    );
    return;
  }
};

module.exports = {
  deleteFolderSql,
  deleteFolderPostgres,
};
