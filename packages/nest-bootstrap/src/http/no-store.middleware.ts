import type { NextFunction, Request, Response } from 'express';

/** No API response may be cached: tokens, recovery codes, session state, personal data, one-time PINs. */
export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
