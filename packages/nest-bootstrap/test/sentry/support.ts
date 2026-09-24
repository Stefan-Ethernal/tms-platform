import type { Event } from '@sentry/nestjs';

/** Local shape: `@sentry/core` (which exports `Envelope`) is not resolvable under pnpm's strict layout. */
export type Envelope = [unknown, Array<[{ type?: string }, unknown]>];

/** Never dialled: Prisma connects lazily and no route in these specs touches the database. */
export const UNUSED_DATABASE_URL = 'postgresql://tms:tms@127.0.0.1:9/unused';

/** Transport factory that records envelopes instead of sending them. */
export function recordingTransport(captured: Envelope[]) {
  return () => ({
    send: (envelope: unknown) => {
      captured.push(envelope as Envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });
}

/** Error events among the envelopes; the first envelope is often a `client_report`. */
export function capturedEvents(captured: readonly Envelope[]): Event[] {
  return captured.flatMap(([, items]) =>
    items.filter(([header]) => header.type === 'event').map(([, payload]) => payload as Event),
  );
}
