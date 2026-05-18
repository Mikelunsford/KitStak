import { Routes, Route, Navigate } from 'react-router-dom';
import { SignInPage } from './pages/SignInPage';
import { DashboardPage } from './pages/DashboardPage';
import { RequireAuth } from './components/shell/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
