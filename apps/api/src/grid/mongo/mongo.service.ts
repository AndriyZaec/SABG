import { MongoClient, type Db } from "mongodb";
import { gridConfig } from "../config/env.js";
import { logger } from "../logger.js";

export class MongoService {
  private static client: MongoClient | undefined;
  private static db: Db | undefined;

  public static async getDb(): Promise<Db> {
    if (!MongoService.db) {
      if (!gridConfig.mongo.uri) {
        throw new Error(
          "MONGODB_URI is not set — required for grid:record, and for the CS2 live poller when CS2_RAW_RECORDING_ENABLED=true",
        );
      }
      MongoService.client = new MongoClient(gridConfig.mongo.uri, {
        maxIdleTimeMS: 60_000,
        retryWrites: true,
        retryReads: true,
        w: "majority",
        serverSelectionTimeoutMS: 5_000,
      });

      MongoService.client.on("serverHeartbeatFailed", (event) =>
        logger.warn({ err: event.failure }, "mongo heartbeat failed"),
      );

      await MongoService.client.connect();
      MongoService.db = MongoService.client.db(gridConfig.mongo.db);
      logger.info({ db: gridConfig.mongo.db }, "MongoDB connected");
    }
    return MongoService.db;
  }

  public static async quit(): Promise<void> {
    if (MongoService.client) {
      await MongoService.client.close();
      MongoService.client = undefined;
      MongoService.db = undefined;
    }
  }
}
