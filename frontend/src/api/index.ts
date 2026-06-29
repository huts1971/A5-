export { getSpotCollectionStats, getSpots, getSpotDetail } from './spots';
export { recommendRoutes } from './routes';
export { chatWithGuide, mockChatApi, realChatApi, streamChatWithGuide } from './chat';
export { clearChatLogs, deleteChatLog, deleteChatLogs, getChatLogs } from './logs';
export { getAdminDashboard } from './dashboard';
export { listKnowledgeDocs, listWebFactCandidates, rebuildKnowledgeIndex, reviewWebFactCandidate } from './knowledge';
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
  ChatLogDeleteResult,
  ChatLogItem,
  ChatLogQuery,
  KnowledgeDocItem,
  KnowledgeRebuildResult,
  WebFactCandidate,
  WebFactCandidateStatus,
  WebFactReviewAction,
} from '../types/api';
