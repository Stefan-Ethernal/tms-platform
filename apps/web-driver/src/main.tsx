import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_ENABLE_MOCKS !== 'true') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// A failed mock worker start (e.g. no service worker outside a secure context) must not leave a
// blank page: log it and render without mocks.
void enableMocking()
  .catch((error: unknown) => {
    console.error('Mock service worker failed to start; rendering without mocks.', error);
  })
  .then(() => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
