import { type OptionsType, ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_SCORE = 3;

export type PasswordViolation = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_WEAK';

// The password itself is bounded by `PASSWORD_MAX_LENGTH` before scoring, but `userInputs` is an
// unbounded caller-supplied list; without its own cap, a caller passing an attacker-sized list (or
// a single attacker-sized string, which `flatMap`'s split can turn into many entries) would defeat
// the scoring-cost bound the `maxLength`/`l33tMaxSubstitutions` tuning below is meant to guarantee
// (security review, task 04, finding 4). 50 raw inputs and 254 bytes each (RFC 5321's email length
// cap, generous for names/usernames too) comfortably covers the callers this phase has (email,
// username, first/last name).
const MAX_USER_INPUTS = 50;
const MAX_USER_INPUT_LENGTH = 254;

/** Tuned per spike S3b: bounds the l33t enumeration and the scored prefix (scores unchanged on the reference set). */
const options: OptionsType = {
  translations: en.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...en.dictionary },
  l33tMaxSubstitutions: 16,
  maxLength: 64,
};
const zxcvbn = new ZxcvbnFactory(options);

/** Length first (cheap), then strength with the user's own data as guessable inputs. */
export function checkPassword(
  password: string,
  userInputs: readonly string[],
): { ok: true } | { ok: false; violations: PasswordViolation[] } {
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, violations: ['TOO_LONG'] };
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, violations: ['TOO_SHORT'] };
  const inputs = userInputs
    .slice(0, MAX_USER_INPUTS)
    .map((v) => v.slice(0, MAX_USER_INPUT_LENGTH))
    .flatMap((v) => [v, ...v.split(/[@.\s_-]+/)])
    .filter((v) => v.length >= 3)
    .slice(0, MAX_USER_INPUTS * 8);
  return zxcvbn.check(password, inputs).score >= PASSWORD_MIN_SCORE
    ? { ok: true }
    : { ok: false, violations: ['TOO_WEAK'] };
}
