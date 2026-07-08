// Ported subset of world-cup's errors.ts — only the error classes the live worker's auth
// chain and Mongo repository actually throw.

export class AppError extends Error {
  public readonly statusCode: number;
  public override readonly cause?: unknown;

  constructor(message: string, statusCode: number, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A downstream dependency (TxODDS API, TxLINE activation, etc.) failed (502). */
export class UpstreamApiError extends AppError {
  public readonly upstreamStatus: number | undefined;

  constructor(message: string, upstreamStatus?: number, cause?: unknown) {
    super(message, 502, cause);
    this.upstreamStatus = upstreamStatus;
  }
}

/** A datastore operation (MongoDB, etc.) failed (503 — treat as a transient dependency outage). */
export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 503, cause);
  }
}
