const fs = require("fs");
const path = require("path");

const postgresDir = () => {
  const postgresDir = "./postgresDumps";
  if (!fs.existsSync(postgresDir)) {
    fs.mkdirSync(postgresDir);
    console.log("Postgres Directory created");
  }
  return postgresDir;
};

const sqlDir = () => {
  const sqlDir = "./sqlDumps";
  if (!fs.existsSync(sqlDir)) {
    fs.mkdirSync(sqlDir);
    console.log("SQL Directory created");
  }
  return sqlDir;
};

const logPathDir = () => {
  const logs = "./logs";
  if (!fs.existsSync(logs)) {
    fs.mkdirSync(logs);
  }
  return logs;
};

const logs = logPathDir();

const successLogFunc = () => {
  const successLog = path.join(String(logs), "success.txt");
  if (!fs.existsSync(successLog)) {
    fs.writeFileSync(successLog, "");
    console.log(`Logs file created: ${successLog}`);
  }
  return successLog;
};
const errorLogFunc = () => {
  const errorLog = path.join(String(logs), "error.txt");
  if (!fs.existsSync(errorLog)) {
    fs.writeFileSync(errorLog, "");
    console.log(`Logs file created: ${errorLog}`);
  }
  return errorLog;
};

module.exports = { errorLogFunc, successLogFunc, postgresDir, sqlDir };
