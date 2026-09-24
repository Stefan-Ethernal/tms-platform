import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, ApiErrorSchema, DomainError, isDomainError } from '../src/index.js';

describe('API error envelope', () => {
  it('maps every code to an HTTP error status', () => {
    for (const [code, status] of Object.entries(API_ERROR_CODES)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('pins the statuses the clients depend on', () => {
    expect(API_ERROR_CODES).toMatchObject({
      VALIDATION_FAILED: 422,
      CONFLICT: 409,
      REFERENCE_CONFLICT: 409,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      ORIGIN_REJECTED: 403,
      ROUTE_NOT_DECLARED: 403,
      RATE_LIMITED: 429,
      REQUEST_REJECTED: 400,
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_ACCOUNT_LOCKED: 423,
      AUTH_MFA_RESET_PENDING: 403,
      AUTH_TOKEN_INVALID: 400,
      AUTH_STEP_UP_REQUIRED: 403,
      LAST_ADMIN: 409,
      INTERNAL: 500,
    });
  });

  it('lets the generic REQUEST_REJECTED code carry any 4xx status', () => {
    expect(
      ApiErrorSchema.safeParse({
        statusCode: 405,
        code: 'REQUEST_REJECTED',
        message: 'Method Not Allowed',
      }).success,
    ).toBe(true);
  });

  it('parses a validation envelope and rejects unknown codes and keys', () => {
    const ok = ApiErrorSchema.safeParse({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      fields: [{ path: 'password', code: 'PASSWORD_TOO_WEAK', message: 'Password is too weak' }],
    });
    expect(ok.success).toBe(true);
    expect(ApiErrorSchema.safeParse({ statusCode: 400, code: 'NOPE', message: 'x' }).success).toBe(
      false,
    );
    expect(
      ApiErrorSchema.safeParse({ statusCode: 500, code: 'INTERNAL', message: 'x', stack: 'at' })
        .success,
    ).toBe(false);
  });

  it('recognises domain errors by brand, not by class identity', () => {
    const err = new DomainError('AUTH_ACCOUNT_LOCKED', 'Account locked', { retryAfterSeconds: 60 });
    expect(err.statusCode).toBe(423);
    expect(isDomainError(err)).toBe(true);
    expect(isDomainError({ isDomainError: true, code: 'AUTH_ACCOUNT_LOCKED', message: 'x' })).toBe(
      true,
    );
    expect(isDomainError({ isDomainError: true, code: 'NOPE' })).toBe(false);
    expect(isDomainError(new Error('x'))).toBe(false);
  });
});
