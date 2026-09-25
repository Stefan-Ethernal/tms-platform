import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  API_ERROR_CODES,
  type ApiError,
  type ApiErrorCode,
  isDomainError,
  scrubString,
} from '@tms/contracts';
import type { Response } from 'express';

const BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  415: 'VALIDATION_FAILED',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

function envelope(code: ApiErrorCode, message: string, extra: Partial<ApiError> = {}): ApiError {
  return { statusCode: API_ERROR_CODES[code], code, message, ...extra };
}

interface PrismaKnownError {
  code: 'P2002' | 'P2003';
  meta?: unknown;
}

/** Duck-typed so nest-bootstrap needs no Prisma dependency: P2002 = unique violation, P2003 = foreign-key RESTRICT. */
function asPrismaKnownError(e: unknown): PrismaKnownError | null {
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return code === 'P2002' || code === 'P2003' ? (e as PrismaKnownError) : null;
}

/** Prisma 7 driver-adapter errors name the constraint at `meta.driverAdapterError.cause.constraint.index`. */
function violatedConstraint(meta: unknown): string | undefined {
  const index = (
    meta as { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } | undefined
  )?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === 'string' ? index : undefined;
}

/** Prisma's default names: `User_email_key` → ['email'], `Widget_ownerId_name_key` → ['ownerId', 'name']; other names → []. */
function uniqueFields(constraint: string | undefined): string[] {
  const match = constraint?.match(/^[A-Z][A-Za-z0-9]*_([A-Za-z0-9_]+)_key$/);
  return match?.[1] ? match[1].split('_') : [];
}

/** Maps any thrown value to the ADR 0009 envelope. Unknown errors never leak details. */
export function toApiError(exception: unknown): ApiError {
  if (isDomainError(exception)) {
    const { fields, retryAfterSeconds } = exception.details;
    return envelope(exception.code, exception.message, {
      ...(fields ? { fields } : {}),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    });
  }
  const prisma = asPrismaKnownError(exception);
  if (prisma?.code === 'P2002') {
    const fields = uniqueFields(violatedConstraint(prisma.meta)).map((path) => ({
      path,
      code: 'UNIQUE',
      message: 'Already exists',
    }));
    return envelope('CONFLICT', 'Already exists', fields.length ? { fields } : {});
  }
  if (prisma?.code === 'P2003') return envelope('REFERENCE_CONFLICT', 'Still referenced');
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return envelope('INTERNAL', 'Internal server error');
    const code = BY_STATUS[status];
    if (code === 'VALIDATION_FAILED') return envelope(code, 'Malformed request');
    const response = exception.getResponse();
    const rawMessage =
      typeof response === 'object' &&
      response !== null &&
      typeof (response as { message?: unknown }).message === 'string'
        ? (response as { message: string }).message
        : exception.message;
    // Defense-in-depth: every current HttpException message is a static developer literal, but
    // scrub it anyway so a future one built from request data can never leak a secret verbatim.
    const message = scrubString(rawMessage);
    // An unlisted 4xx (405, 406, 418, 431, ...) keeps its status; only the code is generic.
    return code
      ? envelope(code, message)
      : envelope('REQUEST_REJECTED', message, { statusCode: status });
  }
  return envelope('INTERNAL', 'Internal server error');
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toApiError(exception);
    if (body.statusCode === 429 && body.retryAfterSeconds === undefined) {
      // @nestjs/throttler 6 sets one `retry-after-<throttler name>` header per throttler, not `Retry-After` (spike N3).
      const waits = Object.entries(res.getHeaders())
        .filter(([name]) => name.startsWith('retry-after-'))
        .map(([, value]) => Number(value))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (waits.length) body.retryAfterSeconds = Math.ceil(Math.max(...waits));
    }
    if (body.statusCode >= 500) {
      // Same mechanism as phase 1's SentryGlobalFilter, so the capture spec's assertion stays.
      Sentry.captureException(exception, {
        mechanism: { type: 'auto.http.nestjs.global_filter', handled: false },
      });
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    if (body.retryAfterSeconds) res.setHeader('Retry-After', String(body.retryAfterSeconds));
    res.status(body.statusCode).json(body);
  }
}
