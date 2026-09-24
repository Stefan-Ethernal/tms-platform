import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import * as fc from 'fast-check';
import { REQUEST_ID_HEADER, REQUEST_ID_PATTERN, resolveRequestId } from '../src/request-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type RequestWithId = IncomingMessage & { id?: unknown };

function exchange(header?: string | string[]): { req: RequestWithId; res: ServerResponse } {
  const req: RequestWithId = new IncomingMessage(new Socket());
  if (header !== undefined) req.headers[REQUEST_ID_HEADER] = header;
  return { req, res: new ServerResponse(req) };
}

describe('resolveRequestId', () => {
  it('keeps a well-formed caller id, stores it on req.id and echoes it', () => {
    const { req, res } = exchange('abc-123._XYZ');
    expect(resolveRequestId(req, res)).toBe('abc-123._XYZ');
    expect(req.id).toBe('abc-123._XYZ');
    expect(res.getHeader('x-request-id')).toBe('abc-123._XYZ');
  });

  it('accepts exactly 64 characters and replaces 65', () => {
    expect(resolveRequestId(exchange('a'.repeat(64)).req)).toBe('a'.repeat(64));
    expect(resolveRequestId(exchange('a'.repeat(65)).req)).toMatch(UUID_V4);
  });

  it.each([
    ['CR/LF injection', 'bad\r\nid'],
    ['200 characters', 'x'.repeat(200)],
    ['spaces', 'bad id with spaces'],
    ['an empty value', ''],
    ['non-ASCII', 'id-ü'],
    ['duplicate headers', ['a', 'b']],
  ])('replaces %s with a UUID and echoes the UUID', (_label, header) => {
    const { req, res } = exchange(header);
    const id = resolveRequestId(req, res);
    expect(id).toMatch(UUID_V4);
    expect(res.getHeader('x-request-id')).toBe(id);
  });

  it('mints a UUID when the header is absent and memoizes it on req.id', () => {
    const { req, res } = exchange();
    const first = resolveRequestId(req, res);
    expect(first).toMatch(UUID_V4);
    expect(resolveRequestId(req, res)).toBe(first);
    expect(resolveRequestId(exchange().req)).not.toBe(first);
  });

  it('prefers an id already on req.id, so pino-http and the CLS middleware agree', () => {
    const { req } = exchange('from-header');
    req.id = 'set-by-the-first-caller';
    expect(resolveRequestId(req)).toBe('set-by-the-first-caller');
  });

  it('works without a response object', () => {
    expect(resolveRequestId(exchange('no-response').req)).toBe('no-response');
  });

  it('always returns a pattern-conforming id that equals the header exactly when the header conforms', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'binary', maxLength: 80 }),
          fc.stringMatching(/^[A-Za-z0-9._-]{1,64}$/),
        ),
        (header) => {
          const id = resolveRequestId(exchange(header).req);
          expect(id).toMatch(REQUEST_ID_PATTERN);
          expect(id === header).toBe(REQUEST_ID_PATTERN.test(header));
        },
      ),
      { numRuns: 300 },
    );
  });
});
