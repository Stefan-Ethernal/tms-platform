import { randomBytes } from 'node:crypto';
import { checkPassword } from '../src';

describe('checkPassword (section 8: min 12 characters, zxcvbn ≥ 3)', () => {
  it.each([
    ['Correct-Horse-Battery-Staple-42', []],
    ['correct horse battery staple', []],
    ['Tr0ub4dor&3xK!9q', []],
  ])('accepts %j', (password, userInputs) => {
    expect(checkPassword(password, userInputs)).toEqual({ ok: true });
  });

  it.each([
    ['Sh0rt!', ['TOO_SHORT']],
    ['password1234', ['TOO_WEAK']],
    ['P@ssw0rd!P@ssw0rd!', ['TOO_WEAK']],
    ['x'.repeat(129), ['TOO_LONG']],
  ])('rejects %j with %j', (password, violations) => {
    expect(checkPassword(password, [])).toEqual({ ok: false, violations });
  });

  it('treats personal data as guessable', () => {
    expect(
      checkPassword('ada.lovelace1815', [
        'ada.lovelace1815@example.com',
        'ada.lovelace1815',
        'Ada',
        'Lovelace',
      ]),
    ).toEqual({
      ok: false,
      violations: ['TOO_WEAK'],
    });
  });

  it('checks the length before scoring (an oversized input costs nothing)', () => {
    const started = performance.now();
    expect(checkPassword('a'.repeat(100_000), [])).toEqual({ ok: false, violations: ['TOO_LONG'] });
    expect(performance.now() - started).toBeLessThan(20);
  });

  it('bounds the scoring cost of a 128-character input', () => {
    for (const input of [
      randomBytes(96).toString('base64'),
      'password'.repeat(16),
      'a'.repeat(128),
    ]) {
      const started = performance.now();
      checkPassword(input, []);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
