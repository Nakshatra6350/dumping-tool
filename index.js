const cron = require("node-cron");
const dbConnection = require("./dbConnection.js");
const sqlConnection = require("./sqlConnection.js");
const postgresConnection = require("./postgresConnection.js");
const { deleteFolderSql, deleteFolderPostgres } = require("./deleteFolder.js");

cron.schedule(
  "0 20 * * *",
  async () => {
    async function connection() {
      const databaseUrls = await dbConnection();

      for (const url of databaseUrls) {
        const parts = url.split("://");
        const databaseType = parts[0];
        String(databaseType);
        if (databaseType === "mysql") {
          await sqlConnection(url, databaseType);
        }
        if (databaseType === "postgres") {
          await postgresConnection(url, databaseType);
        }
      }
    }

    async function deleteFolders() {
      try {
        await deleteFolderSql();
        await deleteFolderPostgres();
      } catch (error) {
        console.log("Error in deleting folders : ", error);
      }
    }

    await connection();
    await deleteFolders();
  },
  {
    timezone: "Asia/Kolkata",
  }
);
