import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startFailure = vi.hoisted(() => new Error('service worker unavailable'));

vi.mock('./mocks/browser', () => ({
  worker: { start: () => Promise.reject(startFailure) },
}));

describe('main', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('logs a failed mock worker start and still renders the app', async () => {
    vi.stubEnv('VITE_ENABLE_MOCKS', 'true');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');

    await waitFor(() => expect(screen.getByTestId('app-root')).toBeTruthy());
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), startFailure);
  });
});
