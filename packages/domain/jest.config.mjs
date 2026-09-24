import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname, database: true });
