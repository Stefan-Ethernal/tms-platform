import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as shared from '../../src/shared';

interface Manifest {
  exports: Record<string, unknown>;
  main?: string;
  types?: string;
}

describe('@tms/domain package surface', () => {
  it('exports only ./shared, so the bare specifier cannot resolve', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as Manifest;
    expect(manifest.exports).toEqual({
      './shared': { types: './dist/shared/index.d.ts', default: './dist/shared/index.js' },
    });
    expect(manifest.main).toBeUndefined();
    expect(manifest.types).toBeUndefined();
  });

  it('@tms/domain/shared exports exactly the phase 1 names', () => {
    expect(Object.keys(shared).sort()).toEqual([
      'AUDIT_APP',
      'AccessGuard',
      'AuditService',
      'AuthThrottle',
      'Clock',
      'ClsService',
      'CurrentPrincipal',
      'DenyAllPrincipalResolver',
      'FixedClock',
      'InMemoryMailSender',
      'MailSender',
      'PRINCIPAL_REQUEST_KEY',
      'PrincipalResolver',
      'Propagation',
      'Public',
      'REQUEST_CONTEXT_KEY',
      'RequirePermissions',
      'RequireSession',
      'RequireStepUp',
      'SharedModule',
      'SkipSessionTouch',
      'SystemClock',
      'TransactionHost',
      'Transactional',
      'USER_AGENT_MAX_LENGTH',
      'readRouteAccess',
      'scanRouteAccess',
    ]);
  });
});
