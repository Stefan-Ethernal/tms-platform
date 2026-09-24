export const STEP_UP_WINDOW_SECONDS = 600;

/** A TOTP confirmation within the last 10 minutes (section 8.5); a future timestamp is never fresh. */
export function isStepUpFresh(
  mfaVerifiedAt: Date | null,
  now: Date,
  windowSeconds = STEP_UP_WINDOW_SECONDS,
): boolean {
  if (!mfaVerifiedAt) return false;
  const age = now.getTime() - mfaVerifiedAt.getTime();
  return age >= 0 && age <= windowSeconds * 1000;
}
