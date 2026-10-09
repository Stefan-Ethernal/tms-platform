import { z } from 'zod';
import { UserKindSchema } from '../enums.js';
import { PERMISSION_GROUPS } from '../permissions.js';

export const RoleIdParamSchema = z.strictObject({ id: z.uuid() });
export type RoleIdParam = z.infer<typeof RoleIdParamSchema>;

export const RolePermissionSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
  description: z.string(),
  /** A permission the catalogue no longer lists but the role still holds until an admin removes it. */
  isDeprecated: z.boolean(),
});
export type RolePermission = z.infer<typeof RolePermissionSchema>;

export const RolePermissionGroupSchema = z.strictObject({
  group: z.enum(PERMISSION_GROUPS),
  permissions: z.array(RolePermissionSchema),
});
export type RolePermissionGroup = z.infer<typeof RolePermissionGroupSchema>;

/** 200 body of `GET /roles/:id`: groups follow `PERMISSION_GROUPS`, permissions inside a group follow `code`; empty groups are omitted. */
export const RoleDetailResponseSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  appliesTo: UserKindSchema,
  groups: z.array(RolePermissionGroupSchema),
});
export type RoleDetailResponse = z.infer<typeof RoleDetailResponseSchema>;
