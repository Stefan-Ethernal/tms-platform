import { z } from 'zod';

const empty = z.strictObject({});

/** Spec section 7, loading orders administered from the back office. */
export const OPS_AUDIT_ACTIONS = {
  'admin.order.created': empty,
  'admin.order.updated': empty,
  'admin.order.cancelled': empty,
} as const;
