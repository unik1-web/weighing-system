import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { logger } from '@/lib/logger';

logger.info('app', 'Запуск приложения');

createRoot(document.getElementById('root')!).render(
  <App />
);
