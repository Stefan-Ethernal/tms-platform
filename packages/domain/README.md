# @tms/domain

Nest service-layer modules (spec section 6), reachable only through subpath exports; the bare
specifier `@tms/domain` does not resolve on purpose.

- `@tms/domain/shared` (phase 1): `SharedModule.forRoot({ app })` — CLS request context,
  `@nestjs-cls/transactional` over `PrismaService`, `AuditService`, `Clock`, `MailSender` port.
- `@tms/domain/admin` (phase 3b) and `@tms/domain/checkin` (phase 4) follow.

CommonJS like every Nest-aware library: `nestjs-cls` and `@nestjs-cls/*` are dual packages whose
classes differ between module graphs (ADR-0006). Tests need Docker (Testcontainers).
