import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const start = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('./mocks/browser', () => ({ worker: { start } }));

describe('main without mocks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
  });

  it('does not start the mock worker unless VITE_ENABLE_MOCKS is "true"', async () => {
    vi.stubEnv('VITE_ENABLE_MOCKS', 'false');
    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');

    await waitFor(() => expect(screen.getByTestId('app-root')).toBeTruthy());
    expect(start).not.toHaveBeenCalled();
  });
});
