import { MongoClient } from "mongodb";

// Reuse one client across hot reloads and serverless invocations.
const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export function getMongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
      .connect()
      .catch((err) => {
        globalForMongo._mongoClient = undefined;
        throw err;
      });
  }
  return globalForMongo._mongoClient;
}
