const { MongoClient } = require("mongodb");
require("dotenv").config();

let databaseUrl = [];

const dbConnection = async () => {
  try {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    console.log("Connected to MongoDB");
    const collection = client
      .db(process.env.DB_NAME)
      .collection(process.env.COLLECTION_NAME);
    const sqlCursor = collection.find({ dialect: { $exists: true } });
    const connectionStrings = await sqlCursor.toArray();

    for (let connection in connectionStrings) {
      const document = connectionStrings[connection];
      const key = document.key;
      databaseUrl.push(key);
    }
    const connections = databaseUrl;
    databaseUrl = [];
    console.log(connections);
    return connections;
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
  }
};

module.exports = dbConnection;
