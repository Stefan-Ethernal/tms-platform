# @tms/contracts

Definitions shared by every package and both SPAs: zod enums mirrored in `schema.prisma`
(`DB_MIRRORED_ENUMS`), the permission catalogue (`PERMISSIONS`, `validateCatalogue`), the seeded
roles (`SEEDED_ROLES`), the audit action union with per-action strict metadata schemas
(`AUDIT_ACTIONS`, `parseAuditMetadata`), the redaction rules (`@tms/contracts/security`:
`isSensitiveKey`, `scrubDeep`, `scrubString`, `scrubUrl`) and `EmailSchema`.

ESM, no Node types: the package must stay importable from the browser. Relative imports carry the
`.js` extension. Tests: `pnpm turbo run test --filter=@tms/contracts` (Vitest + fast-check).
