// Ported from world-cup's services/mongo.service.ts. Singleton MongoDB connection for the
// live worker's raw stream storage — targets a dedicated SABG db (`sabg_raw` by default), kept
// separate from the other project's `worldcup_raw` dev data.

import { MongoClient, type Db } from "mongodb";
import { liveConfig } from "../config/env.js";
import { logger } from "../logger.js";

export class MongoService {
  private static client: MongoClient | undefined;
  private static db: Db | undefined;

  public static async getDb(): Promise<Db> {
    if (!MongoService.db) {
      MongoService.client = new MongoClient(liveConfig.mongo.uri, {
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
      MongoService.db = MongoService.client.db(liveConfig.mongo.db);
      logger.info({ db: liveConfig.mongo.db }, "MongoDB connected");
    }
    return MongoService.db;
  }

  /** Closes the MongoDB connection cleanly (used during graceful shutdown). */
  public static async quit(): Promise<void> {
    if (MongoService.client) {
      await MongoService.client.close();
      MongoService.client = undefined;
      MongoService.db = undefined;
    }
  }
}
