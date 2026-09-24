import { z } from 'zod';

/** Stable machine codes of the API error envelope and their HTTP status (ADR 0009). */
export const API_ERROR_CODES = {
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  REFERENCE_CONFLICT: 409,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ORIGIN_REJECTED: 403,
  ROUTE_NOT_DECLARED: 403,
  RATE_LIMITED: 429,
  /** Any other 4xx (405, 406, 431, ...): the envelope keeps the original status, this is only the nominal one. */
  REQUEST_REJECTED: 400,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_MFA_RESET_PENDING: 403,
  AUTH_INVALID_MFA_CODE: 401,
  AUTH_MFA_ATTEMPTS_EXHAUSTED: 401,
  AUTH_TOKEN_INVALID: 400,
  AUTH_STEP_UP_REQUIRED: 403,
  USER_STATE_CONFLICT: 409,
  LAST_ADMIN: 409,
  SELF_ACTION_FORBIDDEN: 403,
  ROLE_KIND_MISMATCH: 422,
  INTERNAL: 500,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

const codes = Object.keys(API_ERROR_CODES) as [ApiErrorCode, ...ApiErrorCode[]];

export const ApiFieldErrorSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ApiFieldError = z.infer<typeof ApiFieldErrorSchema>;

export const ApiErrorSchema = z.strictObject({
  statusCode: z.number().int().min(400).max(599),
  code: z.enum(codes),
  message: z.string(),
  fields: z.array(ApiFieldErrorSchema).optional(),
  retryAfterSeconds: z.number().int().positive().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface DomainErrorDetails {
  fields?: ApiFieldError[];
  retryAfterSeconds?: number;
}

/**
 * Typed business error thrown by services and mapped to the envelope by the API filter.
 * Recognised with `isDomainError` (a brand), never `instanceof`, so a second copy of this
 * package in a process cannot break the mapping.
 */
export class DomainError extends Error {
  readonly isDomainError = true as const;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: DomainErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DomainError';
  }

  get statusCode(): number {
    return API_ERROR_CODES[this.code];
  }
}

export function isDomainError(value: unknown): value is DomainError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { isDomainError?: unknown; code?: unknown };
  return (
    candidate.isDomainError === true &&
    typeof candidate.code === 'string' &&
    Object.hasOwn(API_ERROR_CODES, candidate.code)
  );
}
