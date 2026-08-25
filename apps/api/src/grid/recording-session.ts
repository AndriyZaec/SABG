import type { Document } from "mongodb";
import { MongoService } from "./mongo/mongo.service.js";
import { withRetry } from "../live/retry.js";
import { logger } from "./logger.js";
import { DatabaseError } from "./errors.js";

export interface GridSeriesStateDoc extends Document {
  seriesId: string;
  collectionName: string;
  receivedAt: Date;
  updatedAt?: string;
  httpStatus: number;
  rateLimitRemaining?: string;
  payload: unknown;
}

export function mintCollectionName(seriesId: string, at: Date = new Date()): string {
  const ts = at.toISOString().replace(/[-:.]/g, "");
  return `cs2_series_${seriesId}_${ts}`;
}

export class RecordingSession {
  public readonly collectionName: string;
  private docsWritten = 0;

  constructor(
    public readonly seriesId: string,
    startedAt: Date = new Date(),
  ) {
    this.collectionName = mintCollectionName(seriesId, startedAt);
  }

  get writtenCount(): number {
    return this.docsWritten;
  }

  async write(meta: {
    payload: unknown;
    httpStatus: number;
    updatedAt?: string;
    rateLimitRemaining?: string;
  }): Promise<void> {
    const doc: GridSeriesStateDoc = {
      seriesId: this.seriesId,
      collectionName: this.collectionName,
      receivedAt: new Date(),
      httpStatus: meta.httpStatus,
      payload: meta.payload,
      ...(meta.updatedAt !== undefined && { updatedAt: meta.updatedAt }),
      ...(meta.rateLimitRemaining !== undefined && { rateLimitRemaining: meta.rateLimitRemaining }),
    };

    try {
      const db = await MongoService.getDb();
      const result = await withRetry(() => db.collection<GridSeriesStateDoc>(this.collectionName).insertOne(doc));
      this.docsWritten += 1;
      logger.info(
        {
          collectionName: this.collectionName,
          seriesId: this.seriesId,
          insertedId: result.insertedId,
          docsWritten: this.docsWritten,
        },
        "grid: document written",
      );
    } catch (err) {
      throw new DatabaseError(`Failed to write to collection ${this.collectionName}`, err);
    }
  }
}
