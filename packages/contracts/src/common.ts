import { z } from 'zod';

/**
 * Login and invite emails: trimmed and lower-cased before validation so `Ana@Example.com ` and
 * `ana@example.com` are the same account. zod 4 deprecates `z.string().email()`; the format
 * check is `z.email()` behind a pipe.
 */
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export type Email = z.infer<typeof EmailSchema>;
