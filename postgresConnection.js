const { exec } = require("child_process");
const { URL } = require("url");
const fs = require("fs");
const { postgresDir, successLogFunc, errorLogFunc } = require("./directories");
const getTodayDate = require("./getDateAndTime");

const postgresDumpFolder = postgresDir();
const successLog = successLogFunc();
const errorLog = errorLogFunc();

const dumpDatabase = async (url, outputFile) => {
  return new Promise((resolve, reject) => {
    const command = `pg_dump "${url}" > "${outputFile}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        fs.appendFileSync(errorLog, `Error dumping database : ${error}\n`);
        reject(error);
        return;
      }
      if (stderr) {
        fs.appendFileSync(errorLog, `Error dumping database : ${stderr}\n`);
        reject(new Error(stderr));
        return;
      }

      resolve();
    });
  });
};
const postgresConnection = async (url, databaseType) => {
  const date = getTodayDate();
  const folderPath = `${postgresDumpFolder}/${date}`;
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    const database = parsedUrl.pathname.replace("/", "");

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
      console.log(`Database folder created: ${folderPath}`);
    }
    const outputFile = `${folderPath}/${databaseType}_${host}_${database}.sql\n`;
    await dumpDatabase(url, outputFile);
    fs.appendFileSync(
      successLog,
      `${databaseType} : Database ${database} of host ${host} connected and dumped successfully\n`
    );
  } catch (error) {
    fs.appendFileSync(errorLog, `Error dumping database: ${error.message}`);
  }
};

module.exports = postgresConnection;
