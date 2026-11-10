export { getSpotCollectionStats, getSpots, getSpotDetail } from './spots';
export { recommendRoutes } from './routes';
export { chatWithGuide, mockChatApi, realChatApi, streamChatWithGuide } from './chat';
export { getTtsJobStatus } from './tts';
export { getUserFeedback, submitUserFeedback } from './feedback';
export { clearChatLogs, deleteChatLog, deleteChatLogs, getChatLogs } from './logs';
export {
  getAdminDashboard,
  getAdminDashboardBase,
  getOperationsOverview,
  getVisitorInsightsReport,
} from './dashboard';
export {
  activateDigitalHumanAvatar,
  deleteDigitalHumanAvatar,
  getDigitalHumanAvatarPreview,
  getCurrentDigitalHumanAvatar,
  listDigitalHumanAvatars,
  updateDigitalHumanAvatar,
  uploadDigitalHumanAvatar,
} from './avatars';
export {
  deleteKnowledgeDoc,
  deleteOfficialWebFact,
  listKnowledgeDocs,
  listOfficialWebFacts,
  listWebFactCandidates,
  rebuildKnowledgeIndex,
  reviewWebFactCandidate,
  updateOfficialWebFact,
  updateWebFactCandidate,
  uploadKnowledgeDoc,
} from './knowledge';
export { createApiError, isApiError, requestJson, toApiError } from './client';
export {
  VISITOR_TOKEN_KEY,
  ADMIN_TOKEN_KEY,
  clearAdminToken,
  clearVisitorToken,
  getCurrentUser,
  getCurrentVisitor,
  loginAdmin,
  loginVisitor,
  readAdminToken,
  readVisitorToken,
  saveAdminToken,
  registerVisitor,
  saveVisitorToken,
} from './auth';
export type {
  ApiError,
  AuthResponse,
  AuthUser,
  AdminDashboardData,
  AdminDashboardSummary,
  DigitalHumanAvatar,
  DigitalHumanRuntimeConfig,
  ChatLogDeleteResult,
  ChatLogItem,
  ChatLogQuery,
  UserFeedbackCreate,
  UserFeedbackItem,
  KnowledgeDocItem,
  KnowledgeRebuildResult,
  OfficialWebFact,
  OfficialWebFactUpdate,
  WebFactCandidate,
  WebFactCandidateUpdate,
  WebFactCandidateStatus,
  WebFactReviewAction,
} from '../types/api';
