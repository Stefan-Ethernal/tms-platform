import type { HttpHandler } from 'msw';

/** Request handlers used when VITE_ENABLE_MOCKS=true. FE lanes add handlers per contract. */
export const handlers: HttpHandler[] = [];
