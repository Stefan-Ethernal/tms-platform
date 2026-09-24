import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import pino from 'pino';
import { REDACTED } from '@tms/contracts/security';
import { buildPinoOptions, type LoggerOptions } from '../src/options';
import { MemoryLogStream, type LogRecord } from '../src/testing';

const OPTIONS: LoggerOptions = {
  app: 'api-admin',
  level: 'trace',
  file: { enabled: false, dir: 'unused', retentionDays: 1 },
};
const S = {
  password: 'pw-secret-1a2b', // gitleaks:allow (test fixture, not a secret)
  pin: 'pin-secret-3c4d',
  bearer: 'bearer-secret-5e6f',
  cookie: 'cookie-secret-7a8b',
  token: 'token-secret-9c0d',
  dsn: 'dsn-secret-1e2f',
  deviceKey: 'device-key-secret-5a5a',
  card: 'card-secret-6b6b',
} as const;

function fresh(): { logs: MemoryLogStream; logger: pino.Logger } {
  const logs = new MemoryLogStream();
  return { logs, logger: pino(buildPinoOptions(OPTIONS), logs) };
}

function last(logs: MemoryLogStream): LogRecord {
  const record = logs.records().at(-1);
  if (!record) throw new Error('nothing was logged');
  return record;
}

function expectAbsent(logs: MemoryLogStream, secrets: readonly string[]): void {
  const text = logs.text();
  for (const secret of secrets) expect(text).not.toContain(secret);
}

describe('buildPinoOptions redaction', () => {
  it('redacts nested, array and header values under sensitive keys and keeps harmless keys', () => {
    const { logs, logger } = fresh();
    logger.info(
      {
        user: { name: 'Ana', password: S.password },
        items: [{ pin: S.pin, label: 'main' }],
        headers: {
          AUTHORIZATION: `Bearer ${S.bearer}`,
          'Set-Cookie': [`sid=${S.cookie}`],
          'x-request-id': 'r-1',
        },
        shipping: 'express',
        mapping: 'm-1',
        keyId: 'k-1',
      },
      'nested',
    );
    expect(last(logs)).toMatchObject({
      app: 'api-admin',
      msg: 'nested',
      user: { name: 'Ana', password: REDACTED },
      items: [{ pin: REDACTED, label: 'main' }],
      headers: { AUTHORIZATION: REDACTED, 'Set-Cookie': REDACTED, 'x-request-id': 'r-1' },
      shipping: 'express',
      mapping: 'm-1',
      keyId: 'k-1',
    });
    expectAbsent(logs, [S.password, S.pin, S.bearer, S.cookie]);
  });

  it('scrubs messages and interpolation arguments before pino formats them', () => {
    const { logs, logger } = fresh();
    logger.info(`GET /accept?token=${S.token} Authorization: Bearer ${S.bearer}`);
    logger.info('payload %j', { password: S.password, ok: true });
    logger.info('dsn %s', `postgresql://tms:${S.dsn}@db/tms`);
    logger.info(`body {"pin":"${S.pin}","kioskId":"k1"}`);
    expect(logs.records().map((record) => record.msg)).toEqual([
      `GET /accept?token=${REDACTED} Authorization: Bearer ${REDACTED}`,
      `payload {"password":"${REDACTED}","ok":true}`,
      `dsn postgresql://${REDACTED}@db/tms`,
      `body {"pin":"${REDACTED}","kioskId":"k1"}`,
    ]);
    expectAbsent(logs, [S.token, S.bearer, S.password, S.dsn, S.pin]);
  });

  it('scrubs the message pino copies from a lone Error (finished-line pass)', () => {
    const { logs, logger } = fresh();
    logger.error(new Error(`connect postgresql://tms:${S.dsn}@db/tms failed`));
    expect(last(logs)).toMatchObject({
      msg: `connect postgresql://${REDACTED}@db/tms failed`,
      err: { type: 'Error', message: `connect postgresql://${REDACTED}@db/tms failed` },
    });
    expectAbsent(logs, [S.dsn]);
  });

  it('serializes errors with scrubbed message, stack, causes and own properties', () => {
    const { logs, logger } = fresh();
    const error = Object.assign(
      new Error(`upstream failed token=${S.token}`, {
        cause: new Error(`db postgresql://tms:${S.dsn}@db/tms`),
      }),
      { config: { headers: { authorization: `Bearer ${S.bearer}` }, url: `/x?pin=${S.pin}` } },
    );
    logger.error({ err: error }, 'request to upstream failed');
    const record = last(logs);
    expect(record).toMatchObject({
      msg: 'request to upstream failed',
      err: {
        type: 'Error',
        config: { headers: { authorization: REDACTED }, url: `/x?pin=${REDACTED}` },
      },
    });
    expect((record['err'] as { message: string }).message).toContain(`token=${REDACTED}`);
    expectAbsent(logs, [S.token, S.dsn, S.bearer, S.pin]);
  });

  it('scrubs child bindings (keys and URL values)', () => {
    const { logs, logger } = fresh();
    logger
      .child({ token: S.token, path: `/accept?token=${S.token}`, cardSerial: S.card })
      .info('child line');
    expect(last(logs)).toMatchObject({
      msg: 'child line',
      token: REDACTED,
      path: `/accept?token=${REDACTED}`,
      cardSerial: REDACTED,
    });
    expectAbsent(logs, [S.token, S.card]);
  });

  it('logs a request as id, method, scrubbed url and headers, remote address; a response as its status', () => {
    const { logs, logger } = fresh();
    const req = new IncomingMessage(new Socket());
    req.method = 'POST';
    req.url = `/api/login?token=${S.token}`;
    req.headers = {
      authorization: `Bearer ${S.bearer}`,
      cookie: `sid=${S.cookie}`,
      'x-device-key': S.deviceKey,
      'user-agent': 'UA/1',
    };
    const res = { statusCode: 201, getHeaders: () => ({ 'set-cookie': [`sid=${S.cookie}`] }) };
    logger.info({ req, res }, 'manual');
    const record = last(logs);
    expect(record).toMatchObject({
      req: {
        method: 'POST',
        url: `/api/login?token=${REDACTED}`,
        headers: {
          authorization: REDACTED,
          cookie: REDACTED,
          'x-device-key': REDACTED,
          'user-agent': 'UA/1',
        },
      },
      res: { statusCode: 201 },
    });
    expect(Object.keys(record['res'] as object)).toEqual(['statusCode']);
    expectAbsent(logs, [S.token, S.bearer, S.cookie, S.deviceKey]);
  });
});
