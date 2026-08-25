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

export class RateLimitExhaustedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 429, cause);
  }
}

export class UpstreamApiError extends AppError {
  public readonly upstreamStatus: number | undefined;

  constructor(message: string, upstreamStatus?: number, cause?: unknown) {
    super(message, 502, cause);
    this.upstreamStatus = upstreamStatus;
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 503, cause);
  }
}
