import type { Event, RequestEventData } from '@sentry/nestjs';
import {
  REDACTED,
  isSensitiveKey,
  scrubDeep,
  scrubString,
  scrubUrl,
} from '@tms/contracts/security';

export type SentryApp = 'api-admin' | 'api-driver';

type QueryString = NonNullable<RequestEventData['query_string']>;

/**
 * Sentry's marker for values it filtered itself. It becomes ours before `scrubUrl` runs, which
 * keeps `token=[REDACTED]` whole instead of producing `token=[REDACTED]]`.
 */
const SENTRY_FILTERED = '[Filtered]';

function scrubUrlText(text: string): string {
  return scrubUrl(text.replaceAll(SENTRY_FILTERED, REDACTED));
}

function scrubQueryString(query: QueryString): QueryString {
  if (typeof query === 'string') return scrubUrlText(query);
  if (Array.isArray(query)) {
    return query.map(([key, value]): [string, string] => [
      key,
      isSensitiveKey(key) ? REDACTED : scrubString(value),
    ]);
  }
  return scrubDeep(query);
}

/**
 * `beforeSend` hook: removes secrets before an event leaves the process. Sentry 11 filters a few
 * values itself (`authorization`, `x-device-key`, `?token=` arrive as `[Filtered]`), but not
 * `?pin=`, `?cardSerial=`, secrets inside other headers, messages, exception values or breadcrumb
 * data. Mutates and returns the event, as `beforeSend` expects.
 */
export function scrubSentryEvent<E extends Event>(event: E, { app }: { app: SentryApp }): E {
  const request = event.request;
  if (request) {
    delete request.cookies;
    if (request.headers) request.headers = scrubDeep(request.headers);
    if (request.data !== undefined) request.data = scrubDeep(request.data);
    if (request.query_string !== undefined) {
      request.query_string = scrubQueryString(request.query_string);
    }
    if (request.url) request.url = scrubUrlText(request.url);
  }
  if (event.message) event.message = scrubString(event.message);
  // Positional params cannot be matched against the scrub list, so only the template survives.
  if (event.logentry) {
    const template = event.logentry.message;
    event.logentry = template === undefined ? {} : { message: scrubString(template) };
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
  }
  if (event.extra) event.extra = scrubDeep(event.extra);
  if (event.contexts) event.contexts = scrubDeep(event.contexts);
  if (event.tags) event.tags = scrubDeep(event.tags);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubDeep(b));
  // No user context on the kiosk (spec section 11).
  if (app === 'api-driver') delete event.user;
  return event;
}
