import { buildSentryOptions, initSentry } from '@tms/nest-bootstrap/sentry';

// Runs before Nest is loaded and therefore before loadEnv: the SDK has to see modules as they are
// required. Only the four Sentry variables are read here, raw; loadEnv validates them a moment
// later and stops the boot on a malformed value.
initSentry(buildSentryOptions({ app: 'api-driver', env: process.env }));
