import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { HomePage } from './HomePage';

// HashRouter: GitHub Pages serves static files only, so client routes live after "#".
export function App() {
  return (
    <HashRouter>
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
