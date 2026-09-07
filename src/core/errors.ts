import type { ErrorCode } from "./contracts.js";

// Operation failure mapped by dispatch to the error envelope. Handlers throw
// these instead of returning ad-hoc shapes so every failure carries a
// contract code. Never includes claim tokens, raw input, or stack traces.
export class OpError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "OpError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static validation(message: string): OpError {
    return new OpError("VALIDATION", message);
  }

  static notFound(message: string): OpError {
    return new OpError("NOT_FOUND", message);
  }

  static conflict(message: string): OpError {
    return new OpError("CONFLICT", message);
  }

  static stale(message: string): OpError {
    return new OpError("STALE_CLAIM", message);
  }

  static busy(message: string): OpError {
    return new OpError("BUSY", message);
  }

  static io(message: string): OpError {
    return new OpError("IO", message);
  }

  static internal(message: string): OpError {
    return new OpError("INTERNAL", message);
  }
}
