const { URL } = require("url");
const mysql = require("mysql2/promise");
const fs = require("fs");
const mysqldump = require("mysqldump");
const { sqlDir, successLogFunc, errorLogFunc } = require("./directories");
const getTodayDate = require("./getDateAndTime");

const sqlDumpFolder = sqlDir();
const successLog = successLogFunc();
const errorLog = errorLogFunc();

const sqlConnection = async (url, databaseType) => {
  const date = getTodayDate();
  const folderPath = `${sqlDumpFolder}/${date}`;
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname;
  const user = parsedUrl.username;
  const password = parsedUrl.password;
  const database = parsedUrl.pathname.replace("/", "");

  const connection = await mysql.createConnection({
    host: host,
    user: user,
    password: password,
    database: database,
  });
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
      console.log(`Database folder created: ${folderPath}\n`);
    }

    await mysqldump({
      connection: {
        host: host,
        user: user,
        password: password,
        database: database,
      },
      dumpToFile: `${folderPath}/${databaseType}_${host}_${database}.sql`,
    });

    fs.appendFileSync(
      successLog,
      `${databaseType} : Database ${database} of host ${host} connected and dumped successfully\n`
    );
  } catch (error) {
    fs.appendFileSync(errorLog, `Error dumping database: ${error.message}\n`);
  } finally {
    await connection.end();
  }
};

module.exports = sqlConnection;
