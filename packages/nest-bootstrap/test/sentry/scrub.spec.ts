import type { Event } from '@sentry/nestjs';
import { scrubSentryEvent } from '../../src/sentry';

const SECRETS = [
  'hdr-secret-1',
  'dev-secret-2',
  'ck-secret-3',
  'qs-secret-4',
  'url-secret-5',
  'pw-secret-6',
  'bearer-secret-7',
  'msg-secret-8',
  'extra-secret-9',
  'ctx-secret-10',
  'crumb-secret-11',
  'tag-secret-12',
  'log-secret-13',
];

function fullEvent(): Event {
  return {
    message: 'login failed for token=msg-secret-8',
    logentry: { message: 'retry with password=%s', params: ['log-secret-13'] },
    request: {
      url: 'http://127.0.0.1:3001/api/boom?token=url-secret-5&page=2',
      method: 'POST',
      query_string: 'token=qs-secret-4&page=2',
      headers: {
        authorization: 'Bearer hdr-secret-1',
        'x-device-key': 'dev-secret-2',
        'user-agent': 'UA/1',
        'x-request-id': 'req-1',
      },
      cookies: { sid: 'ck-secret-3' },
      data: {
        user: { email: 'a@example.test', password: 'pw-secret-6' },
        items: [{ pin: '1234' }],
      },
    },
    exception: {
      values: [{ type: 'Error', value: 'upstream said Bearer bearer-secret-7' }, { type: 'Error' }],
    },
    extra: { apiKey: 'extra-secret-9', note: 'kept' },
    contexts: { upstream: { url: 'https://svc.example.test/?token=ctx-secret-10' } },
    tags: { route: 'GET /api/x?token=tag-secret-12' },
    breadcrumbs: [{ message: 'called', data: { authorization: 'Bearer crumb-secret-11' } }],
    user: { id: 'u-1' },
  };
}

describe('scrubSentryEvent', () => {
  it('removes every secret of a fully populated event', () => {
    const serialized = JSON.stringify(scrubSentryEvent(fullEvent(), { app: 'api-admin' }));
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('"1234"');
  });

  it.each<[string, (e: Event) => unknown, unknown]>([
    ['authorization header', (e) => e.request?.headers?.['authorization'], '[REDACTED]'],
    ['custom device-key header', (e) => e.request?.headers?.['x-device-key'], '[REDACTED]'],
    ['harmless headers', (e) => e.request?.headers?.['user-agent'], 'UA/1'],
    ['cookies (dropped entirely)', (e) => e.request?.cookies, undefined],
    ['query string', (e) => e.request?.query_string, 'token=[REDACTED]&page=2'],
    ['url', (e) => e.request?.url, 'http://127.0.0.1:3001/api/boom?token=[REDACTED]&page=2'],
    [
      'request data',
      (e) => e.request?.data,
      { user: { email: 'a@example.test', password: '[REDACTED]' }, items: [{ pin: '[REDACTED]' }] },
    ],
    ['exception value', (e) => e.exception?.values?.[0]?.value, 'upstream said Bearer [REDACTED]'],
    ['exception without value', (e) => e.exception?.values?.[1], { type: 'Error' }],
    ['message', (e) => e.message, 'login failed for token=[REDACTED]'],
    [
      'log entry (params dropped)',
      (e) => e.logentry,
      { message: 'retry with password=[REDACTED]' },
    ],
    ['extra', (e) => e.extra, { apiKey: '[REDACTED]', note: 'kept' }],
    [
      'contexts',
      (e) => e.contexts?.['upstream'],
      { url: 'https://svc.example.test/?token=[REDACTED]' },
    ],
    ['tags', (e) => e.tags?.['route'], 'GET /api/x?token=[REDACTED]'],
    ['breadcrumb data', (e) => e.breadcrumbs?.[0]?.data, { authorization: '[REDACTED]' }],
    ['user on api-admin', (e) => e.user, { id: 'u-1' }],
  ])('scrubs %s', (_field, pick, expected) => {
    expect(pick(scrubSentryEvent(fullEvent(), { app: 'api-admin' }))).toEqual(expected);
  });

  it('turns the values Sentry filtered itself into one marker', () => {
    const event: Event = {
      request: { url: 'http://h/api/x?token=[Filtered]&page=2', query_string: 'token=[Filtered]' },
    };
    expect(scrubSentryEvent(event, { app: 'api-admin' }).request).toEqual({
      url: 'http://h/api/x?token=[REDACTED]&page=2',
      query_string: 'token=[REDACTED]',
    });
  });

  it('scrubs a query string given as key/value pairs', () => {
    const event: Event = {
      request: {
        query_string: [
          ['token', 'qs-1'],
          ['page', '2'],
        ],
      },
    };
    expect(scrubSentryEvent(event, { app: 'api-admin' }).request?.query_string).toEqual([
      ['token', '[REDACTED]'],
      ['page', '2'],
    ]);
  });

  it('removes the user on the kiosk API', () => {
    expect(scrubSentryEvent(fullEvent(), { app: 'api-driver' }).user).toBeUndefined();
  });

  it('returns the same event object and leaves a minimal event unchanged', () => {
    const event: Event = { message: 'mapping shipping keyId=7' };
    expect(scrubSentryEvent(event, { app: 'api-admin' })).toBe(event);
    expect(event).toEqual({ message: 'mapping shipping keyId=7' });
  });
});
