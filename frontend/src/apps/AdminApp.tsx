import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from '../layouts/AdminLayout';
import AdminChatLogPage from '../pages/admin/AdminChatLogPage';
import AdminAvatarPage from '../pages/admin/AdminAvatarPage';
import AdminCommunityPage from '../pages/admin/AdminCommunityPage';
import AdminDashboardPage from '../pages/admin/AdminDashboardPage';
import AdminFeedbackPage from '../pages/admin/AdminFeedbackPage';
import AdminKnowledgePage from '../pages/admin/AdminKnowledgePage';
import AdminLoginPage from '../pages/admin/AdminLoginPage';
import AdminRoutePage from '../pages/admin/AdminRoutePage';
import AdminSpotPage from '../pages/admin/AdminSpotPage';

export default function AdminApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AdminLoginPage />} />
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="/dashboard/charts" replace />} />
          <Route path="/dashboard" element={<Navigate to="/dashboard/charts" replace />} />
          <Route path="/dashboard/charts" element={<AdminDashboardPage view="charts" />} />
          <Route path="/dashboard/hot-questions" element={<AdminDashboardPage view="hot-questions" />} />
          <Route path="/dashboard/visitor-insights" element={<AdminDashboardPage view="visitor-insights" />} />
          <Route path="/spots" element={<AdminSpotPage />} />
          <Route path="/routes" element={<AdminRoutePage />} />
          <Route path="/knowledge" element={<Navigate to="/knowledge/docs" replace />} />
          <Route path="/knowledge/docs" element={<AdminKnowledgePage view="docs" />} />
          <Route path="/knowledge/facts" element={<AdminKnowledgePage view="facts" />} />
          <Route path="/knowledge/candidates" element={<AdminKnowledgePage view="candidates" />} />
          <Route path="/logs" element={<AdminChatLogPage />} />
          <Route path="/community" element={<AdminCommunityPage />} />
          <Route path="/feedback" element={<AdminFeedbackPage />} />
          <Route path="/avatars" element={<AdminAvatarPage />} />
        </Route>
        <Route path="/admin/login" element={<Navigate to="/login" replace />} />
        <Route path="/admin/*" element={<Navigate to="/dashboard/charts" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
