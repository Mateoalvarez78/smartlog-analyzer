/**
 * Application-level error with an HTTP status and a safe, stable code.
 * The message is shown to the caller, so it must never leak internals
 * (raw SQL errors, adapter payloads, stack traces).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(code: string, message: string): AppError {
  return new AppError(400, code, message);
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

export function unprocessable(code: string, message: string): AppError {
  return new AppError(422, code, message);
}
