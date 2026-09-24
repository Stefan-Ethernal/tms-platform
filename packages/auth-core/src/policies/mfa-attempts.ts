export const MFA_MAX_ATTEMPTS = 5;

export function registerMfaAttempt(attempts: number): { attempts: number; exhausted: boolean } {
  const next = attempts + 1;
  return { attempts: next, exhausted: next >= MFA_MAX_ATTEMPTS };
}
