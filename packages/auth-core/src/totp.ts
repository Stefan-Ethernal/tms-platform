import { generate, generateSecret, generateURI, verify } from 'otplib';

export const TOTP_PERIOD_SECONDS = 30;
const CODE = /^\d{6}$/;

export type TotpVerification = { ok: true; step: number } | { ok: false };

// `secret` is not bound/format-validated here: in this package it is only ever the base32 string
// this class itself generated or, at the caller, a value freshly decrypted from storage — never
// unvalidated external input. Deferred (security review, task 05 fix round, finding 4, LOW) until
// a decrypted secret first flows through a caller (Task 11+), where a defensive check belongs
// next to that decryption, not duplicated here.
export interface TotpProvider {
  generateSecret(): string;
  buildUri(input: { issuer: string; account: string; secret: string }): string;
  /** ±1 step (section 8); a match at or before `lastUsedStep` is a replay and fails. */
  verify(input: {
    secret: string;
    code: string;
    now: Date;
    lastUsedStep: number | null;
  }): Promise<TotpVerification>;
}

const epochSeconds = (d: Date) => Math.floor(d.getTime() / 1000);

export class OtplibTotpProvider implements TotpProvider {
  generateSecret(): string {
    return generateSecret();
  }

  buildUri({
    issuer,
    account,
    secret,
  }: {
    issuer: string;
    account: string;
    secret: string;
  }): string {
    return generateURI({ issuer, label: account, secret });
  }

  async verify({
    secret,
    code,
    now,
    lastUsedStep,
  }: {
    secret: string;
    code: string;
    now: Date;
    lastUsedStep: number | null;
  }): Promise<TotpVerification> {
    if (!CODE.test(code)) return { ok: false };
    // otplib throws `AfterTimeStepRangeExceededError` (rather than resolving `{ valid: false }`)
    // when `afterTimeStep` is ahead of the window computed from `now` — reachable from a stored
    // `lastUsedStep` after clock skew or a backward clock jump across replicas. `verify` is typed
    // to never reject, so any otplib error fails closed as a non-match (security review, task 05
    // fix round, finding 1, HIGH).
    try {
      const result = await verify({
        secret,
        token: code,
        epoch: epochSeconds(now),
        epochTolerance: TOTP_PERIOD_SECONDS,
        ...(lastUsedStep === null ? {} : { afterTimeStep: lastUsedStep }),
      });
      return result.valid && 'timeStep' in result
        ? { ok: true, step: result.timeStep }
        : { ok: false };
    } catch {
      return { ok: false };
    }
  }
}

/** The code an authenticator shows at `now` (tests and the E2E TOTP helper). */
export function generateTotpCode(secret: string, now: Date): Promise<string> {
  return generate({ secret, epoch: epochSeconds(now) });
}
