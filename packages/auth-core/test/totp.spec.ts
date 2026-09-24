import { generate } from 'otplib';
import { generateTotpCode, OtplibTotpProvider, TOTP_PERIOD_SECONDS } from '../src';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890" (RFC 6238 test vector) gitleaks:allow
const provider = new OtplibTotpProvider();
const at = (step: number, offsetSeconds = 0) =>
  new Date((step * TOTP_PERIOD_SECONDS + offsetSeconds) * 1000);

describe('OtplibTotpProvider', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC 6238 SHA1 vector at T=%i', async (epoch, expected) => {
    expect(
      await generate({ secret: RFC_SECRET, digits: 8, algorithm: 'sha1', period: 30, epoch }),
    ).toBe(expected);
  });

  it('generates a 20-byte base32 secret and an otpauth URI', () => {
    const secret = provider.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(provider.buildUri({ issuer: 'TMS', account: 'admin@example.com', secret })).toBe(
      `otpauth://totp/TMS:admin%40example.com?secret=${secret}&issuer=TMS`,
    );
  });

  it.each([-1, 0, 1])(
    'accepts a code from step offset %i and returns the matched step',
    async (d) => {
      const step = 60_000_000;
      const code = await generateTotpCode(RFC_SECRET, at(step + d));
      expect(
        await provider.verify({ secret: RFC_SECRET, code, now: at(step, 7), lastUsedStep: null }),
      ).toEqual({ ok: true, step: step + d });
    },
  );

  it.each([-2, 2])('rejects a code from step offset %i', async (d) => {
    const step = 60_000_000;
    const code = await generateTotpCode(RFC_SECRET, at(step + d));
    expect(
      await provider.verify({ secret: RFC_SECRET, code, now: at(step, 7), lastUsedStep: null }),
    ).toEqual({ ok: false });
  });

  it('rejects replay of the last used step and older steps, accepts the next one', async () => {
    const step = 60_000_000;
    const code = await generateTotpCode(RFC_SECRET, at(step));
    expect(
      await provider.verify({ secret: RFC_SECRET, code, now: at(step, 20), lastUsedStep: step }),
    ).toEqual({ ok: false });
    const older = await generateTotpCode(RFC_SECRET, at(step - 1));
    expect(
      await provider.verify({
        secret: RFC_SECRET,
        code: older,
        now: at(step, 20),
        lastUsedStep: step,
      }),
    ).toEqual({ ok: false });
    const next = await generateTotpCode(RFC_SECRET, at(step + 1));
    expect(
      await provider.verify({
        secret: RFC_SECRET,
        code: next,
        now: at(step + 1, 2),
        lastUsedStep: step,
      }),
    ).toEqual({ ok: true, step: step + 1 });
  });

  it.each(['', '12345', '1234567', 'abcdef', ' 123456'])(
    'rejects malformed code %j without calling the library',
    async (code) => {
      expect(
        await provider.verify({
          secret: RFC_SECRET,
          code,
          now: at(60_000_000),
          lastUsedStep: null,
        }),
      ).toEqual({ ok: false });
    },
  );

  // Security review (task 05 fix round), finding 1 (HIGH): otplib throws
  // `AfterTimeStepRangeExceededError` instead of failing closed when `lastUsedStep` is ahead of
  // the window computed from `now` (clock skew or a backward clock jump across replicas), which
  // would otherwise crash the login/MFA caller instead of resolving `{ ok: false }`.
  it('resolves ok:false instead of throwing when lastUsedStep is far ahead of the current window', async () => {
    const step = 60_000_000;
    const code = await generateTotpCode(RFC_SECRET, at(step));
    await expect(
      provider.verify({
        secret: RFC_SECRET,
        code,
        now: at(step, 7),
        lastUsedStep: step + 100,
      }),
    ).resolves.toEqual({ ok: false });
  });
});
