/**
 * EventHub Error Taxonomy (Part 5, Phase 1 — spec §67, §61)
 * ────────────────────────────────────────────────────────────
 * One place that decides what clients see when something fails.
 * Rules:
 *   • Every error has a machine CODE and an HTTP STATUS.
 *   • Internal details (stack traces, provider errors, Mongo errors)
 *     are NEVER exposed unless the error is intentionally public.
 *   • `retryable` marks transient failures — the ONLY thing the retry
 *     helper will ever retry (§30).
 *
 * The normalizer `errorResponse(err)` maps unknown shapes (Mongoose,
 * JWT, multer, raw Errors) onto safe responses:
 *   { status, body: { success: false, message, error: { code, message } } }
 * `message` stays at the top level for backward compatibility with the
 * existing frontend (toasts read `message`); new code reads `error.code`.
 */

/* ── Base ── */
class AppError extends Error {
  /**
   * @param {string} message      safe, user-facing message (when expose=true)
   * @param {object} opts
   * @param {number} opts.status   HTTP status
   * @param {string} opts.code     machine-readable error code
   * @param {boolean} opts.expose  may the message be shown to clients?
   * @param {boolean} opts.retryable is this a transient failure worth retrying?
   */
  constructor(message, { status = 500, code = "INTERNAL", expose = true, retryable = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.retryable = retryable;
  }
}

/* ── Taxonomy (§67) ── */
class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super(message, { status: 400, code: "VALIDATION_FAILED" });
  }
}
class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { status: 401, code: "UNAUTHORIZED" });
  }
}
class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that") {
    super(message, { status: 403, code: "FORBIDDEN" });
  }
}
class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, { status: 404, code: "NOT_FOUND" });
  }
}
class ConflictError extends AppError {
  constructor(message = "That already exists") {
    super(message, { status: 409, code: "CONFLICT" });
  }
}
class RateLimitError extends AppError {
  /**
   * @param {number} retryAfterMs seconds→header computed by the caller (§25)
   */
  constructor(message = "Too many requests. Please try again shortly.", retryAfterMs = 60_000) {
    super(message, { status: 429, code: "RATE_LIMITED" });
    this.retryAfterMs = retryAfterMs;
  }
}
class DatabaseUnavailableError extends AppError {
  constructor(message = "The database is temporarily unavailable") {
    super(message, { status: 503, code: "DATABASE_UNAVAILABLE", retryable: true });
  }
}
class StorageUploadError extends AppError {
  constructor(message = "Upload failed — please try again") {
    super(message, { status: 502, code: "STORAGE_UPLOAD_FAILED" });
  }
}
class ProviderUnavailableError extends AppError {
  constructor(message = "A dependent service is temporarily unavailable") {
    super(message, { status: 503, code: "PROVIDER_UNAVAILABLE", retryable: true });
  }
}
class OperationTimeoutError extends AppError {
  constructor(message = "The operation took too long and was aborted") {
    super(message, { status: 504, code: "OPERATION_TIMEOUT", retryable: true });
  }
}

/* ── Normalizer (§61: never leak internals) ── */

/**
 * Map any thrown value onto a safe HTTP response.
 * AppErrors keep their intent; foreign shapes get translated:
 *   • Mongoose ValidationError → 400 VALIDATION_FAILED (first issue)
 *   • CastError                → 400 VALIDATION_FAILED
 *   • duplicate key (11000)    → 409 CONFLICT (friendly field name)
 *   • JWT errors               → 401 UNAUTHORIZED
 *   • multer payload errors    → 400
 *   • anything else            → 500 INTERNAL with a generic message
 */
function errorResponse(error) {
  const err = error || {};

  // Already ours — trust it (but never expose when told not to)
  if (err instanceof AppError) {
    const message = err.expose ? err.message : "Something went wrong. Please try again.";
    return {
      status: err.status,
      retryAfterMs: err.retryAfterMs,
      body: { success: false, message, error: { code: err.code, message } },
    };
  }

  // Mongoose validation
  if (err.name === "ValidationError" && err.errors) {
    const first = Object.values(err.errors)[0];
    return {
      status: 400,
      body: { success: false, message: first?.message || "Invalid input", error: { code: "VALIDATION_FAILED", message: first?.message || "Invalid input" } },
    };
  }

  // Bad ObjectId etc.
  if (err.name === "CastError") {
    return {
      status: 400,
      body: { success: false, message: "Invalid identifier", error: { code: "VALIDATION_FAILED", message: "Invalid identifier" } },
    };
  }

  // Duplicate key (unique index) — idempotency guard surface (§28)
  if (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000)) {
    const field = err.keyValue ? Object.keys(err.keyValue)[0] : null;
    const message = field ? `That ${field} is already in use` : "That already exists";
    return {
      status: 409,
      body: { success: false, message, error: { code: "CONFLICT", message } },
    };
  }

  // JWT family
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return {
      status: 401,
      body: { success: false, message: "Invalid or expired token", error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } },
    };
  }

  // Multer
  if (err.name === "MulterError") {
    const sizeRelated = err.code === "LIMIT_FILE_SIZE";
    const message = sizeRelated ? "File is too large" : "Upload failed";
    return {
      status: 400,
      body: { success: false, message, error: { code: "VALIDATION_FAILED", message } },
    };
  }

  // express-rate-limit throws with status/statusCode but no code — keep 429 shape
  if (Number(err.status) === 429 || Number(err.statusCode) === 429) {
    const message = "Too many requests. Please try again shortly.";
    return {
      status: 429,
      retryAfterMs: 60_000,
      body: { success: false, message, error: { code: "RATE_LIMITED", message } },
    };
  }

  // Unknown — log-worthy, never leaked (§61)
  return {
    status: 500,
    body: { success: false, message: "Something went wrong. Please try again.", error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
  };
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseUnavailableError,
  StorageUploadError,
  ProviderUnavailableError,
  OperationTimeoutError,
  errorResponse,
};
