import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import PublicRoute from './routes/PublicRoute.jsx';
import { StrictMode } from 'react';
import '@xyflow/react/dist/style.css';
import './index.css';

// Service worker: la app queda guardada y abre sin internet
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PublicRoute>

    </PublicRoute>
  </StrictMode>
);
