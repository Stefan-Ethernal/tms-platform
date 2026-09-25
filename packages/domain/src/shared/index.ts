export * from './access';
export { AUDIT_APP, AuditService, type AuditRecordInput } from './audit.service';
export { Clock, FixedClock, SystemClock } from './clock';
export { InMemoryMailSender, MailSender, type MailMessage } from './mail';
export { REQUEST_CONTEXT_KEY, USER_AGENT_MAX_LENGTH, type RequestContext } from './request-context';
export { SharedModule, type SharedModuleOptions } from './shared.module';
export type { AppTransactionHost } from './transaction';
// Values, not only types: consumers inject them (`@Inject(TransactionHost)`, `ClsService`). Going
// through this module keeps later modules off the dual-build libraries themselves.
export { Propagation, Transactional, TransactionHost } from '@nestjs-cls/transactional';
export { ClsService } from 'nestjs-cls';
