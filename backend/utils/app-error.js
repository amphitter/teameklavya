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

/* ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · §30  THE CANONICAL ERROR CODE SET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ten codes, and no others, for the HTTP API. Finer distinctions are carried
 * by the HTTP STATUS, not by inventing a new code: a 413 and a 400 are both
 * VALIDATION_ERROR, because "your input was wrong" is the whole of what the
 * client needs to know and the status already says how.
 *
 * Why a closed set: every code a controller can invent is a code the client
 * has to handle, and the ones nobody handles are the ones that silently turn
 * into "something went wrong" in the UI. A closed set is enforceable — there
 * is a test that scans the codebase for ad-hoc error shapes.
 *
 * Part 5 used a slightly different vocabulary (VALIDATION_FAILED, UNAUTHORIZED,
 * OPERATION_TIMEOUT, INTERNAL, PAYLOAD_TOO_LARGE, DATABASE_UNAVAILABLE,
 * STORAGE_UPLOAD_FAILED). Those names are folded into these ten. The frontend
 * only ever branched on RATE_LIMITED, which is unchanged, so the rename is
 * safe; the LEGACY_ALIASES map below still normalises a stale code string if
 * one ever reaches the handler, so an old build degrades rather than 500s.
 *
 * SCOPE: this is the HTTP taxonomy. The Socket.IO wire protocol has its own
 * code set in config/socket-protocol.js, which the live-event frontend already
 * depends on; §30 is not a mandate to rename that protocol out from under it.
 */
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

/** Part 5 names → §30 names. Only used to normalise stale strings. */
const LEGACY_ALIASES = Object.freeze({
  VALIDATION_FAILED: ERROR_CODES.VALIDATION_ERROR,
  UNAUTHORIZED: ERROR_CODES.AUTH_REQUIRED,
  OPERATION_TIMEOUT: ERROR_CODES.TIMEOUT,
  INTERNAL: ERROR_CODES.INTERNAL_ERROR,
  PAYLOAD_TOO_LARGE: ERROR_CODES.VALIDATION_ERROR,
  DATABASE_UNAVAILABLE: ERROR_CODES.PROVIDER_UNAVAILABLE,
  STORAGE_UPLOAD_FAILED: ERROR_CODES.PROVIDER_UNAVAILABLE,
});

/** Canonicalise any code string onto the §30 set. Unknown → INTERNAL_ERROR. */
function canonicalCode(code) {
  if (!code) return ERROR_CODES.INTERNAL_ERROR;
  if (Object.prototype.hasOwnProperty.call(ERROR_CODES, code)) return code;
  return LEGACY_ALIASES[code] || ERROR_CODES.INTERNAL_ERROR;
}

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
  constructor(message, { status = 500, code = ERROR_CODES.INTERNAL_ERROR, expose = true, retryable = false } = {}) {
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
    super(message, { status: 400, code: ERROR_CODES.VALIDATION_ERROR });
  }
}
class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { status: 401, code: ERROR_CODES.AUTH_REQUIRED });
  }
}
class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that") {
    super(message, { status: 403, code: ERROR_CODES.FORBIDDEN });
  }
}
class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, { status: 404, code: ERROR_CODES.NOT_FOUND });
  }
}
class ConflictError extends AppError {
  constructor(message = "That already exists") {
    super(message, { status: 409, code: ERROR_CODES.CONFLICT });
  }
}
class RateLimitError extends AppError {
  /**
   * @param {number} retryAfterMs seconds→header computed by the caller (§25)
   */
  constructor(message = "Too many requests. Please try again shortly.", retryAfterMs = 60_000) {
    super(message, { status: 429, code: ERROR_CODES.RATE_LIMITED });
    this.retryAfterMs = retryAfterMs;
  }
}
class DatabaseUnavailableError extends AppError {
  constructor(message = "The database is temporarily unavailable") {
    super(message, { status: 503, code: ERROR_CODES.PROVIDER_UNAVAILABLE, retryable: true });
  }
}
/**
 * §30: the tenth code, and the one Part 5 had no name for.
 *
 * A retried write whose idempotency key is already claimed is NOT a 400 — the
 * request was well-formed — and NOT a 409 in the ordinary sense, because the
 * collision is about the RETRY, not about the resource state. The client needs
 * to distinguish "your change conflicted with someone else's" (409 CONFLICT)
 * from "you already sent this" (409 IDEMPOTENCY_CONFLICT), because the
 * recovery is different: the first needs a re-read, the second needs nothing.
 */
class IdempotencyConflictError extends AppError {
  constructor(message = "This request was already processed") {
    super(message, { status: 409, code: ERROR_CODES.IDEMPOTENCY_CONFLICT });
  }
}

class StorageUploadError extends AppError {
  constructor(message = "Upload failed — please try again") {
    super(message, { status: 502, code: ERROR_CODES.PROVIDER_UNAVAILABLE });
  }
}
class ProviderUnavailableError extends AppError {
  constructor(message = "A dependent service is temporarily unavailable") {
    super(message, { status: 503, code: ERROR_CODES.PROVIDER_UNAVAILABLE, retryable: true });
  }
}
class OperationTimeoutError extends AppError {
  constructor(message = "The operation took too long and was aborted") {
    super(message, { status: 504, code: ERROR_CODES.TIMEOUT, retryable: true });
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
      body: { success: false, message, error: { code: canonicalCode(err.code), message } },
    };
  }

  // Mongoose validation
  if (err.name === "ValidationError" && err.errors) {
    const first = Object.values(err.errors)[0];
    return {
      status: 400,
      body: { success: false, message: first?.message || "Invalid input", error: { code: ERROR_CODES.VALIDATION_ERROR, message: first?.message || "Invalid input" } },
    };
  }

  // Bad ObjectId etc.
  if (err.name === "CastError") {
    return {
      status: 400,
      body: { success: false, message: "Invalid identifier", error: { code: ERROR_CODES.VALIDATION_ERROR, message: "Invalid identifier" } },
    };
  }

  // Duplicate key (unique index) — idempotency guard surface (§28)
  if (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000)) {
    const field = err.keyValue ? Object.keys(err.keyValue)[0] : null;
    const message = field ? `That ${field} is already in use` : "That already exists";
    return {
      status: 409,
      body: { success: false, message, error: { code: ERROR_CODES.CONFLICT, message } },
    };
  }

  // JWT family
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return {
      status: 401,
      body: { success: false, message: "Invalid or expired token", error: { code: ERROR_CODES.AUTH_REQUIRED, message: "Invalid or expired token" } },
    };
  }

  // Multer
  if (err.name === "MulterError") {
    const sizeRelated = err.code === "LIMIT_FILE_SIZE";
    const message = sizeRelated ? "File is too large" : "Upload failed";
    return {
      status: 400,
      body: { success: false, message, error: { code: ERROR_CODES.VALIDATION_ERROR, message } },
    };
  }

  /* ── Body-parser request errors (Part 5, Phase 9 — §63 / §71) ─────────
   * These are CLIENT faults that arrive before any controller runs, and they
   * were falling through to a 500. That is wrong twice over: it reports a
   * user mistake as a server fault (so it pollutes error alerting and looks
   * like an outage), and it tells the client to retry a request that will
   * never succeed. Both carry a `type` from body-parser, so they are
   * unambiguous and safe to special-case.
   *   entity.parse.failed  — malformed JSON             → 400
   *   entity.too.large     — body over the §63 limit    → 413
   *   entity.verify.failed / request.aborted            → 400
   */
  if (err.type === "entity.parse.failed") {
    const message = "Malformed JSON body.";
    return {
      status: 400,
      body: { success: false, message, error: { code: ERROR_CODES.VALIDATION_ERROR, message } },
    };
  }
  if (err.type === "entity.too.large") {
    const message = "Request body is too large.";
    return {
      status: 413,
      body: { success: false, message, error: { code: ERROR_CODES.VALIDATION_ERROR, message } },
    };
  }
  if (err.type === "entity.verify.failed" || err.type === "request.aborted") {
    const message = "Invalid request body.";
    return {
      status: 400,
      body: { success: false, message, error: { code: ERROR_CODES.VALIDATION_ERROR, message } },
    };
  }

  /* A well-behaved middleware that has already decided the status (body-parser
   * sets status 400/413, multer sets 400) must not be downgraded or upgraded
   * to 500. Only trust 4xx — never let a library's 5xx skip our logging path. */
  const libStatus = Number(err.status || err.statusCode);
  // 429 is deliberately excluded here: it has its own contract below
  // (RATE_LIMITED + Retry-After) and must keep it.
  if (Number.isInteger(libStatus) && libStatus >= 400 && libStatus < 500 && libStatus !== 429) {
    const message =
      libStatus === 413 ? "Request body is too large." : String(err.message || "Invalid request.");
    /* Preserve the code the caller chose when it has one. This branch used to
     * flatten EVERY library 4xx to VALIDATION_FAILED, which meant a middleware
     * that deliberately returned 403 was reported to the client as a validation
     * problem — and a client that branches on the code took the wrong recovery
     * path. Canonicalise instead of assuming. */
    const code = err.code ? canonicalCode(err.code) : ERROR_CODES.VALIDATION_ERROR;
    return {
      status: libStatus,
      body: { success: false, message, error: { code, message } },
    };
  }

  // express-rate-limit throws with status/statusCode but no code — keep 429 shape
  if (Number(err.status) === 429 || Number(err.statusCode) === 429) {
    const message = "Too many requests. Please try again shortly.";
    return {
      status: 429,
      retryAfterMs: 60_000,
      body: { success: false, message, error: { code: ERROR_CODES.RATE_LIMITED, message } },
    };
  }

  /* A code we recognise but that never matched above — e.g. a stale Part 5 name
   * on an object that is not one of our classes. Honour it rather than falling
   * through: silently rewriting a caller's deliberate 403 into a 500 turns a
   * handled case into an apparent outage. */
  if (err.code && (ERROR_CODES[err.code] || LEGACY_ALIASES[err.code])) {
    const mapped = canonicalCode(err.code);
    const status = Number(err.status || err.statusCode) || 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const safeMessage = String(err.message || "Request failed");
    return {
      status: safeStatus,
      body: { success: false, message: safeMessage, error: { code: mapped, message: safeMessage } },
    };
  }

  // Unknown — log-worthy, never leaked (§61)
  return {
    status: 500,
    body: { success: false, message: "Something went wrong. Please try again.", error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Something went wrong. Please try again." } },
  };
}

/** Send an error through the taxonomy from a controller (§30). */
function sendError(res, error) {
  const normalized = errorResponse(error);
  if (normalized.retryAfterMs) {
    res.set("Retry-After", Math.ceil(normalized.retryAfterMs / 1000));
  }
  return res.status(normalized.status).json(normalized.body);
}

module.exports = {
  ERROR_CODES,
  LEGACY_ALIASES,
  canonicalCode,
  sendError,
  AppError,
  IdempotencyConflictError,
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
