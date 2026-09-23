import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('mounts the application root', () => {
    render(<App />);
    expect(screen.getByTestId('app-root')).toBeTruthy();
  });

  it('renders no user-facing text yet (all copy arrives through i18n keys in phase 6)', () => {
    const { container } = render(<App />);
    expect(container.textContent).toBe('');
  });
});
