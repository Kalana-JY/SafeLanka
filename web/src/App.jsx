import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { I18nProvider } from './context/I18nContext';
import ProtectedRoute from './components/ProtectedRoute';
import NavBar from './components/NavBar';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dmc from './pages/Dmc';
import District from './pages/District';
import ShelterOps from './pages/Shelter';
import Team from './pages/Team';
import { Unauthorized, NotFound, ComingSoon, Footer } from './pages/Misc';
import './index.css';

export default function App() {
  return (
    <AuthProvider>
      <I18nProvider>
      <BrowserRouter>
      <div className="app">
        <NavBar />
        <main className="main">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route
            path="/dmc"
            element={
              <ProtectedRoute allow={['DMC_OFFICER']}>
                <Dmc />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute allow={['TEAM_LEADER']}>
                <Team />
              </ProtectedRoute>
            }
          />
          <Route
            path="/district"
            element={
              <ProtectedRoute allow={['DISTRICT_OFFICER']}>
                <District />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shelter"
            element={
              <ProtectedRoute allow={['WARDEN']}>
                <ShelterOps />
              </ProtectedRoute>
            }
          />
          <Route path="/health" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </main>
        <Footer />
      </div>
      </BrowserRouter>
      </I18nProvider>
    </AuthProvider>
  );
}
