import { z } from 'zod';

const empty = z.strictObject({});
const id = z.string().min(1).max(64);
const kioskId = z.string().min(1).max(64);
const sequenceNumber = z.number().int().min(1);

export const IdentifyFailureReasonSchema = z.enum([
  'UNKNOWN_CARD',
  'CARD_BLOCKED',
  'DRIVER_NOT_ACTIVE',
  'NO_PERMISSION',
  'ADR_EXPIRED',
  'PIN_INCORRECT',
  'PIN_LOCKED',
]);
export type IdentifyFailureReason = z.infer<typeof IdentifyFailureReasonSchema>;

/**
 * Spec sections 8 (driver) and 10. The card serial is never metadata: an identify failure targets
 * the IdentityCard by id when the card is known and has no target otherwise.
 */
export const CHECKIN_AUDIT_ACTIONS = {
  'checkin.identify.success': z.strictObject({ kioskId }),
  'checkin.identify.failure': z.strictObject({ kioskId, reason: IdentifyFailureReasonSchema }),
  'checkin.pin.locked': z.strictObject({
    failedAttempts: z.number().int().min(1),
    lockedUntil: z.iso.datetime(),
  }),
  'checkin.order.confirmed': z.strictObject({ kioskId }),
  'checkin.queue.checked-in': z.strictObject({ sequenceNumber, kioskId }),
  'checkin.queue.manual-checkin': z.strictObject({ sequenceNumber }),
  'checkin.queue.point-assigned': z.strictObject({ loadingPointId: id }),
  'checkin.queue.called': empty,
  'checkin.queue.completed': empty,
  'checkin.queue.removed': z.strictObject({ reason: z.string().min(1).max(200) }),
} as const;
