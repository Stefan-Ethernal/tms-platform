import { checkPassword, type PasswordViolation } from '@tms/auth-core';
import { type ApiFieldError, DomainError } from '@tms/contracts';

export const totpAad = (userId: string): string => `totp:${userId}`;

const MESSAGES: Record<PasswordViolation, string> = {
  TOO_SHORT: 'Use at least 12 characters',
  TOO_LONG: 'Use at most 128 characters',
  TOO_WEAK: 'Password is too easy to guess',
};

export function passwordFieldErrors(
  violations: readonly PasswordViolation[],
  path = 'password',
): ApiFieldError[] {
  return violations.map((v) => ({ path, code: `PASSWORD_${v}`, message: MESSAGES[v] }));
}

export function assertStrongPassword(
  password: string,
  user: { email: string | null; username: string; firstName: string; lastName: string },
  path = 'password',
): void {
  const result = checkPassword(password, [
    user.email ?? '',
    user.username,
    user.firstName,
    user.lastName,
  ]);
  if (!result.ok)
    throw new DomainError('VALIDATION_FAILED', 'Validation failed', {
      fields: passwordFieldErrors(result.violations, path),
    });
}
