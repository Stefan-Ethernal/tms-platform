/**
 * Jest configuration for NestJS apps (mirrors the official Nest 12 template).
 * Run with `NODE_OPTIONS=--experimental-vm-modules` because @nestjs/* ship ESM.
 *
 * @param {{ rootDir: string }} options
 * @returns {import('jest').Config}
 */
export function createJestConfig({ rootDir }) {
  return {
    rootDir,
    moduleFileExtensions: ['js', 'json', 'ts'],
    testEnvironment: 'node',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
    collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
    coverageDirectory: '<rootDir>/coverage',
  };
}
