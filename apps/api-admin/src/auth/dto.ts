import {
  AcceptInviteRequestSchema,
  SetPasswordRequestSchema,
  TotpConfirmRequestSchema,
  UserIdParamSchema,
} from '@tms/contracts';
import { zodDto } from '@tms/nest-bootstrap';

export class AcceptInviteDto extends zodDto(AcceptInviteRequestSchema) {}
export class UserIdParamDto extends zodDto(UserIdParamSchema) {}
export class SetPasswordDto extends zodDto(SetPasswordRequestSchema) {}
export class TotpConfirmDto extends zodDto(TotpConfirmRequestSchema) {}
