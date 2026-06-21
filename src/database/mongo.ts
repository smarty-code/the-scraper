import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Connects to the MongoDB database using the environment variables in .env
 */
export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DATABASE_NAME || "master";

  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not defined in .env");
  }

  console.log(`[Database] Connecting to MongoDB...`);
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`[Database] Connected successfully to database: ${dbName}`);
  
  // Initialize indexes
  const { initializeDatabase } = await import("./models");
  await initializeDatabase(db);

  return db;
}

/**
 * Closes the active MongoDB connection
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log("[Database] MongoDB connection closed.");
  }
}
