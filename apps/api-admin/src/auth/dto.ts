import {
  AcceptInviteRequestSchema,
  CreateUserRequestSchema,
  LoginRequestSchema,
  MfaRequestSchema,
  SetPasswordRequestSchema,
  TotpConfirmRequestSchema,
  UserIdParamSchema,
} from '@tms/contracts';
import { zodDto } from '@tms/nest-bootstrap';

export class AcceptInviteDto extends zodDto(AcceptInviteRequestSchema) {}
export class UserIdParamDto extends zodDto(UserIdParamSchema) {}
export class SetPasswordDto extends zodDto(SetPasswordRequestSchema) {}
export class TotpConfirmDto extends zodDto(TotpConfirmRequestSchema) {}
export class CreateUserDto extends zodDto(CreateUserRequestSchema) {}
export class LoginDto extends zodDto(LoginRequestSchema) {}
// MfaRequestSchema is a union: its inferred type is not an object type, so `class extends` (TS2509)
// is not available here; the const + type-alias pair gives the same runtime class and static type.
export const MfaDto = zodDto(MfaRequestSchema);
export type MfaDto = InstanceType<typeof MfaDto>;
