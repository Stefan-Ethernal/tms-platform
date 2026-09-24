import { z } from 'zod';

// Every enum mirrored in schema.prisma is defined here once (spec section 3); a `@tms/db` test
// asserts set equality between DB_MIRRORED_ENUMS and the generated Prisma $Enums.

export const UserKindSchema = z.enum(['STAFF', 'DRIVER']);
export type UserKind = z.infer<typeof UserKindSchema>;

export const UserStatusSchema = z.enum(['INVITED', 'ACTIVE', 'BLOCKED', 'DEACTIVATED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const DriverTypeSchema = z.enum(['TRUCK', 'RAIL']);
export type DriverType = z.infer<typeof DriverTypeSchema>;

export const IdentityCardStatusSchema = z.enum(['ACTIVE', 'BLOCKED']);
export type IdentityCardStatus = z.infer<typeof IdentityCardStatusSchema>;

export const SessionScopeSchema = z.enum(['PRE_MFA', 'ENROLLMENT', 'FULL']);
export type SessionScope = z.infer<typeof SessionScopeSchema>;

export const ActionTokenTypeSchema = z.enum(['INVITE', 'PASSWORD_RESET', 'MFA_RESET']);
export type ActionTokenType = z.infer<typeof ActionTokenTypeSchema>;

export const VehicleKindSchema = z.enum(['TRUCK', 'RAIL_WAGON']);
export type VehicleKind = z.infer<typeof VehicleKindSchema>;

export const LoadingPointKindSchema = z.enum(['TRUCK_ISLAND', 'RAIL_TRACK']);
export type LoadingPointKind = z.infer<typeof LoadingPointKindSchema>;

export const TransportKindSchema = z.enum(['TRUCK', 'RAIL']);
export type TransportKind = z.infer<typeof TransportKindSchema>;

export const LoadingOrderStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'CALLED',
  'LOADED',
  'CANCELLED',
]);
export type LoadingOrderStatus = z.infer<typeof LoadingOrderStatusSchema>;

export const QueueEntryStatusSchema = z.enum(['WAITING', 'CALLED', 'DONE', 'REMOVED']);
export type QueueEntryStatus = z.infer<typeof QueueEntryStatusSchema>;

export const CheckInViaSchema = z.enum(['KIOSK', 'MANUAL']);
export type CheckInVia = z.infer<typeof CheckInViaSchema>;

export const AuditAppSchema = z.enum(['ADMIN', 'DRIVER', 'SYSTEM']);
export type AuditApp = z.infer<typeof AuditAppSchema>;

export const AuditOutcomeSchema = z.enum(['SUCCESS', 'FAILURE']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/** Keyed by the Prisma enum name; the key set must equal the enums declared in schema.prisma. */
export const DB_MIRRORED_ENUMS = {
  UserKind: UserKindSchema,
  UserStatus: UserStatusSchema,
  DriverType: DriverTypeSchema,
  IdentityCardStatus: IdentityCardStatusSchema,
  SessionScope: SessionScopeSchema,
  ActionTokenType: ActionTokenTypeSchema,
  VehicleKind: VehicleKindSchema,
  LoadingPointKind: LoadingPointKindSchema,
  TransportKind: TransportKindSchema,
  LoadingOrderStatus: LoadingOrderStatusSchema,
  QueueEntryStatus: QueueEntryStatusSchema,
  CheckInVia: CheckInViaSchema,
  AuditApp: AuditAppSchema,
  AuditOutcome: AuditOutcomeSchema,
} as const satisfies Record<string, z.ZodEnum>;

export type PrismaEnumName = keyof typeof DB_MIRRORED_ENUMS;
