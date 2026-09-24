import { describe, expect, it } from 'vitest';
import {
  AcceptInviteRequestSchema,
  ChangeRoleRequestSchema,
  LoginRequestSchema,
  MfaRequestSchema,
  RecoveryCodesResponseSchema,
  SessionStateResponseSchema,
  UnblockUserResponseSchema,
} from '../src/index.js';

const token = 'A'.repeat(43);

describe('auth DTO schemas', () => {
  it('normalises the login email and bounds the password length', () => {
    const parsed = LoginRequestSchema.parse({ email: '  Ada@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('ada@example.com');
    expect(
      LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success,
    ).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x', extra: 1 }).success).toBe(
      false,
    );
  });

  it('accepts exactly one second factor', () => {
    expect(MfaRequestSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(MfaRequestSchema.safeParse({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS' }).success).toBe(true);
    expect(MfaRequestSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(
      MfaRequestSchema.safeParse({ code: '123456', recoveryCode: 'ABCD-EFGH-JKMN-PQRS' }).success,
    ).toBe(false);
  });

  it('accepts only 32-byte base64url tokens', () => {
    expect(AcceptInviteRequestSchema.safeParse({ token }).success).toBe(true);
    expect(AcceptInviteRequestSchema.safeParse({ token: `${token}=` }).success).toBe(false);
    expect(AcceptInviteRequestSchema.safeParse({ token: token.slice(1) }).success).toBe(false);
  });

  it('describes recovery codes and session state', () => {
    const codes = Array.from({ length: 10 }, () => 'ABCD-EFGH-JKMN-PQRS');
    expect(RecoveryCodesResponseSchema.safeParse({ recoveryCodes: codes }).success).toBe(true);
    expect(RecoveryCodesResponseSchema.safeParse({ recoveryCodes: codes.slice(1) }).success).toBe(
      false,
    );
    expect(
      SessionStateResponseSchema.safeParse({
        scope: 'ENROLLMENT',
        next: 'ENROLL_TOTP',
        user: {
          id: '0190a0b0-0000-7000-8000-000000000000',
          email: 'a@b.co',
          firstName: 'A',
          lastName: 'B',
        },
      }).success,
    ).toBe(true);
    expect(ChangeRoleRequestSchema.safeParse({ roleId: 'admin' }).success).toBe(false);
    expect(UnblockUserResponseSchema.safeParse({ status: 'INVITED' }).success).toBe(true);
    expect(UnblockUserResponseSchema.safeParse({ status: 'BLOCKED' }).success).toBe(false);
  });
});
