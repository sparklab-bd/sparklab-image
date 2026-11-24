import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register self-updating Service Worker for 100% offline PWA functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/' })
      .then((registration) => {
        registration.update().catch(() => undefined);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(<App />);
