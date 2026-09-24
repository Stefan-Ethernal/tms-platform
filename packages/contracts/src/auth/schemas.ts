import { z } from 'zod';
import { EmailSchema } from '../common.js';
import { SessionScopeSchema } from '../enums.js';

const Password = z.string().min(1).max(128);
const TotpCode = z.string().regex(/^\d{6}$/);
/** 32 random bytes, base64url without padding. */
const RawToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const CROCKFORD_GROUP = '[0-9A-HJKMNP-TV-Z]{4}';
const RecoveryCode = z.string().regex(new RegExp(`^${CROCKFORD_GROUP}(-${CROCKFORD_GROUP}){3}$`));

export const LoginRequestSchema = z.strictObject({ email: EmailSchema, password: Password });
/** The live TOTP code travels under `totpCode`, not the bare `code`, so `totp` (a whole-word
 * sensitive token) scrubs it automatically wherever the request body is logged or captured. */
export const MfaRequestSchema = z.union([
  z.strictObject({ totpCode: TotpCode }),
  z.strictObject({ recoveryCode: RecoveryCode }),
]);
export const AcceptInviteRequestSchema = z.strictObject({ token: RawToken });
export const SetPasswordRequestSchema = z.strictObject({ password: Password });
export const TotpEnrollmentResponseSchema = z.strictObject({
  otpauthUri: z.string().startsWith('otpauth://totp/'),
  secret: z.string().regex(/^[A-Z2-7]+=*$/),
});
export const TotpConfirmRequestSchema = z.strictObject({ totpCode: TotpCode });
export const RecoveryCodesResponseSchema = z.strictObject({
  recoveryCodes: z
    .array(z.string().regex(new RegExp(`^${CROCKFORD_GROUP}(-${CROCKFORD_GROUP}){3}$`)))
    .length(10),
});
export const SESSION_NEXT_STEPS = ['SET_PASSWORD', 'ENROLL_TOTP', 'VERIFY_MFA', 'NONE'] as const;
export const SessionStateResponseSchema = z.strictObject({
  scope: SessionScopeSchema,
  next: z.enum(SESSION_NEXT_STEPS),
  user: z.strictObject({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  }),
});
export const ForgotPasswordRequestSchema = z.strictObject({ email: EmailSchema });
export const ResetPasswordRequestSchema = z.strictObject({ token: RawToken, password: Password });
export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: Password,
  newPassword: Password,
});
export const StepUpRequestSchema = z.strictObject({ totpCode: TotpCode });
export const AcceptMfaResetRequestSchema = z.strictObject({ token: RawToken, password: Password });
export const ChangeRoleRequestSchema = z.strictObject({ roleId: z.uuid() });
export const UserIdParamSchema = z.strictObject({ id: z.uuid() });
/** 202 body of admin actions that mail a single-use link (the link itself never travels over HTTP). */
export const ActionTokenIssuedResponseSchema = z.strictObject({ expiresAt: z.iso.datetime() });
/** Unblock returns INVITED when the user never enrolled TOTP (Task 20). */
export const UnblockUserResponseSchema = z.strictObject({ status: z.enum(['ACTIVE', 'INVITED']) });

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type MfaRequest = z.infer<typeof MfaRequestSchema>;
export type SessionStateResponse = z.infer<typeof SessionStateResponseSchema>;
export type SessionNextStep = (typeof SESSION_NEXT_STEPS)[number];
export type ActionTokenIssuedResponse = z.infer<typeof ActionTokenIssuedResponseSchema>;
export type UnblockUserResponse = z.infer<typeof UnblockUserResponseSchema>;
