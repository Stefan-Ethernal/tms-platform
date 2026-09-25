import {
  type ArgumentsHost,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  SetMetadata,
} from '@nestjs/common';
import { API_ERROR_CODES, isDomainError, PUBLIC_ROUTE_KEY } from '@tms/contracts';
import type { Response } from 'express';
import {
  CurrentPrincipal,
  type Principal,
  Public,
  RequirePermissions,
  RequireSession,
  RequireStepUp,
} from '../../src/shared';

@Controller('p')
export class ProbeController {
  @Get('none') none() {
    return 'none';
  }
  @Public() @RequireSession('FULL') @Get('two') two() {
    return 'two';
  }
  @Public() @Get('public') pub() {
    return 'public';
  }
  @RequireSession('ENROLLMENT') @Get('enrol') enrol(@CurrentPrincipal() p: Principal) {
    return p.userId;
  }
  @RequireSession('ANY') @Get('any') any() {
    return 'any';
  }
  @RequirePermissions('users:read', 'users:block') @Get('perm') perm() {
    return 'perm';
  }
  @RequirePermissions('users:block') @RequireStepUp() @Get('stepup') stepUp() {
    return 'stepup';
  }
}

@SetMetadata(PUBLIC_ROUTE_KEY, true)
@Controller('c')
export class ClassMarkedController {
  @Get() x() {
    return 'x';
  }
}

/** Test-only: DomainError → `{ statusCode, code, message }`, anything else → 500. */
@Catch()
export class DomainErrorTestFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (!isDomainError(exception)) {
      res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
      return;
    }
    const statusCode = API_ERROR_CODES[exception.code];
    res.status(statusCode).json({ statusCode, code: exception.code, message: exception.message });
  }
}
