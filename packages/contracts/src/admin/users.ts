import { z } from 'zod';
import { EmailSchema } from '../common.js';
import { UserKindSchema, UserStatusSchema } from '../enums.js';

/**
 * Admin-created users are always STAFF (driver creation is a separate, later feature); the
 * invite is issued by `InviteService` right after the row is created.
 */
export const CreateUserRequestSchema = z.strictObject({
  email: EmailSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  roleId: z.uuid(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

/** 201 body of `POST /users`; the invite link itself never travels over HTTP. */
export const CreateUserResponseSchema = z.strictObject({
  userId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;

const RoleRefSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
});

export const UserSummarySchema = z.strictObject({
  id: z.uuid(),
  email: EmailSchema.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  status: UserStatusSchema,
  kind: UserKindSchema,
  role: RoleRefSchema,
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const UserListResponseSchema = z.strictObject({
  users: z.array(UserSummarySchema),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const RoleSummarySchema = z.strictObject({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  appliesTo: UserKindSchema,
});
export type RoleSummary = z.infer<typeof RoleSummarySchema>;

export const RoleListResponseSchema = z.strictObject({
  roles: z.array(RoleSummarySchema),
});
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;
