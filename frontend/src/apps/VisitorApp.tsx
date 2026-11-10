import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { UnityWebGLGuideRuntimeProvider } from '../components/guide/UnityWebGLGuideRuntime';
import VisitorLayout from '../layouts/VisitorLayout';
import AiGuidePage from '../pages/visitor/AiGuidePage';
import CommunityPage from '../pages/visitor/CommunityPage';
import DigitalHumanSettingsPage from '../pages/visitor/DigitalHumanSettingsPage';
import HomePage from '../pages/visitor/HomePage';
import PanoramaMapPage from '../pages/visitor/PanoramaMapPage';
import PhotoWorkshopPage from '../pages/visitor/PhotoWorkshopPage';
import RouteDraftPage from '../pages/visitor/RouteDraftPage';
import RouteRecommendPage from '../pages/visitor/RouteRecommendPage';
import SceneGuidePage from '../pages/visitor/SceneGuidePage';
import SpotDetailPage from '../pages/visitor/SpotDetailPage';
import SpotListPage from '../pages/visitor/SpotListPage';
import TourPage from '../pages/visitor/TourPage';
import TourRecapPage from '../pages/visitor/TourRecapPage';
import TourRecapsPage from '../pages/visitor/TourRecapsPage';
import TravelJournalPage from '../pages/visitor/TravelJournalPage';
import VisitorLoginPage from '../pages/visitor/VisitorLoginPage';
import VisitorRegisterPage from '../pages/visitor/VisitorRegisterPage';
import VisitorServicePage from '../pages/visitor/VisitorServicePage';

export default function VisitorApp() {
  return (
    <BrowserRouter>
      <UnityWebGLGuideRuntimeProvider>
        <Routes>
          <Route path="/login" element={<VisitorLoginPage />} />
          <Route path="/register" element={<VisitorRegisterPage />} />
          <Route element={<VisitorLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/spots" element={<SpotListPage />} />
            <Route path="/spots/:spotId" element={<SpotDetailPage />} />
            <Route path="/routes" element={<RouteRecommendPage />} />
            <Route path="/route-drafts/:draftId" element={<RouteDraftPage />} />
            <Route path="/tour/:tourId" element={<TourPage />} />
            <Route path="/tour/:tourId/recap" element={<TourRecapPage />} />
            <Route path="/tour-recaps" element={<TourRecapsPage />} />
            <Route path="/guide" element={<AiGuidePage />} />
            <Route path="/scene-guide" element={<SceneGuidePage />} />
            <Route path="/digital-human-settings" element={<DigitalHumanSettingsPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/travel-journal" element={<TravelJournalPage />} />
            <Route path="/photo-workshop" element={<PhotoWorkshopPage />} />
            <Route path="/panorama" element={<PanoramaMapPage />} />
            <Route path="/services" element={<Navigate to="/services/heatmap" replace />} />
            <Route path="/services/:serviceId" element={<VisitorServicePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </UnityWebGLGuideRuntimeProvider>
    </BrowserRouter>
  );
}
