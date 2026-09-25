import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@tms/contracts';

export const ORIGIN_ALLOWLIST = 'tms:origin-allowlist';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** D11: mutations need an allowed Origin, or Sec-Fetch-Site: same-origin when Origin is absent. Fail-closed. */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(@Inject(ORIGIN_ALLOWLIST) allowlist: readonly string[]) {
    this.allowed = new Set(allowlist);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ method: string; headers: Record<string, string | undefined> }>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    const origin = req.headers['origin'];
    if (origin !== undefined) {
      if (this.allowed.has(origin)) return true;
    } else if (req.headers['sec-fetch-site'] === 'same-origin') {
      return true;
    }
    throw new DomainError('ORIGIN_REJECTED', 'Cross-origin request rejected');
  }
}
