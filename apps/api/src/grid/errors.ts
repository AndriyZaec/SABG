// Error classes specific to the Grid.gg poller. Kept local (rather than importing
// src/live/errors.ts) so this module has no dependency on the TXODDS/live worker track.

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

/** All GRID_MAX_RATE_LIMIT_RETRIES consecutive 429 retries were exhausted for one poll attempt. */
export class RateLimitExhaustedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 429, cause);
  }
}

/** The Grid.gg endpoint returned a non-2xx, non-429 response, or the request failed outright. */
export class UpstreamApiError extends AppError {
  public readonly upstreamStatus: number | undefined;

  constructor(message: string, upstreamStatus?: number, cause?: unknown) {
    super(message, 502, cause);
    this.upstreamStatus = upstreamStatus;
  }
}

/** A MongoDB write for a recording session failed (after retry). */
export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 503, cause);
  }
}
