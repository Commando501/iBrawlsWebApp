import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { clearDevelopmentServiceWorker } from './services/developmentServiceWorker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// An accidental two-finger pinch can zoom the page/PWA and break the
// on-screen controls. Viewport flags + body touch-action handle most cases,
// but they are overridden when a user enables Chrome's "Force enable zoom"
// accessibility setting — so also cancel the gesture at the event level.
// preventDefault on touchmove only blocks the browser's default zoom/scroll;
// pointer events still fire, so the sticks (and two-stick play) keep working.
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// iOS Safari ignores user-scalable and doesn't honor touch-action for page
// zoom; block its proprietary gesture events too (no-op on Android).
const preventZoomGesture = (e: Event) => e.preventDefault();
document.addEventListener('gesturestart', preventZoomGesture, { passive: false });
document.addEventListener('gesturechange', preventZoomGesture, { passive: false });
document.addEventListener('gestureend', preventZoomGesture, { passive: false });

if (import.meta.env.DEV) {
  void clearDevelopmentServiceWorker({
    origin: window.location.origin,
    serviceWorkers: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    cacheStorage: 'caches' in window ? window.caches : undefined,
  }).then((needsReload) => {
    if (needsReload) window.location.reload();
  }).catch((error) => {
    console.warn('Development service worker cleanup failed:', error);
  });
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registration.update().catch(() => undefined);
      })
      .catch((error) => {
        console.warn('Service worker registration failed:', error);
      });
  });
}
