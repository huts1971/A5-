import type { ApiError } from './api';

export type GuideStatus = 'idle' | 'thinking' | 'speaking';

export type PhysicalLevel = 'low' | 'medium' | 'high';
export type RoutingProfile = 'fastest' | 'easy' | 'accessible';
export type TimeEstimationStatus =
  | 'map_estimate'
  | 'uncalibrated'
  | 'legacy_fallback'
  | 'unavailable';

export type SpotTone = 'water' | 'culture' | 'garden' | 'service';

export interface ScenicSpot {
  id: string;
  name: string;
  subtitle: string;
  summary: string;
  story: string;
  tags: string[];
  crowdTypes: string[];
  durationMinutes: number;
  openInfo: string;
  serviceHint: string;
  coverTone: SpotTone;
  imageUrl?: string;
  highlights: string[];
}

export interface SpotCollectionStats {
  listedSpotCount: number;
  collectedSpotCount: number;
}

export interface RouteSpot {
  spotId: string;
  name: string;
  stayMinutes: number;
  reason: string;
  transitionMinutes?: number | null;
  transitionNote?: string;
}

export interface RoutePlan {
  id: string;
  mapId: 'ling-shan' | 'nianhua-bay';
  name: string;
  theme: string;
  durationMinutes: number;
  suitableCrowd: string[];
  description: string;
  reason: string;
  stayMinutes?: number;
  estimatedWalkMinutes?: number;
  timeDataComplete?: boolean;
  generationMode?: 'dynamic' | 'template_fallback';
  preferenceMatch?: number;
  constraintSummary?: string;
  pathComplete?: boolean;
  routingProfile?: RoutingProfile;
  timeEstimationStatus?: TimeEstimationStatus;
  spots: RouteSpot[];
}

export interface RouteDraftSpot extends RouteSpot {
  sequence: number;
}

export interface RouteDraft {
  id: string;
  sourceRouteId?: string;
  name: string;
  theme: string;
  durationBudget: number;
  preferenceProfile: Partial<RoutePreferenceInput>;
  stayMinutes: number;
  estimatedWalkMinutes: number;
  totalMinutes: number;
  timeDataComplete: boolean;
  routingProfile: RoutingProfile;
  timeEstimationStatus: TimeEstimationStatus;
  budgetExceeded: boolean;
  revisionCount: number;
  spots: RouteDraftSpot[];
  createdAt: string;
  updatedAt: string;
}

export type TourSpotStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface TourSpot extends RouteDraftSpot {
  status: TourSpotStatus;
  arrivedAt?: string;
  completedAt?: string;
}

export interface TourSession {
  id: string;
  routeDraftId: string;
  name: string;
  status: 'active' | 'finished';
  currentIndex: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  eventCount: number;
  routingProfile: RoutingProfile;
  timeEstimationStatus: TimeEstimationStatus;
  spots: TourSpot[];
}

export interface TourRecapSpot {
  spotId: string;
  name: string;
  result: 'completed' | 'skipped';
  occurredAt: string;
}

export interface TourRecap {
  id: string;
  name: string;
  status: 'active' | 'finished';
  startedAt: string;
  finishedAt?: string;
  elapsedMinutes: number;
  completedCount: number;
  skippedCount: number;
  adjustmentCount: number;
  deviationCount: number;
  recommendedOrder: string[];
  preferenceProfile: Partial<RoutePreferenceInput>;
  actualOrder: TourRecapSpot[];
  aiTopics: string[];
}

export interface RoutePreferenceInput {
  mapId: 'ling-shan' | 'nianhua-bay';
  durationMinutes: number;
  physicalLevel: PhysicalLevel;
  interestTags: string[];
}

export type MapPointType = 'spot' | 'service' | 'entrance' | string;

export type MapCalibrationStatus = 'verified' | 'pending_review' | string;

export interface ScenicMapPoint {
  spotId: string;
  name: string;
  xRatio: number;
  yRatio: number;
  pointType: MapPointType;
  calibrationStatus: MapCalibrationStatus;
}

export interface ScenicMap {
  id: string;
  name: string;
  imageUrl: string;
  version: string;
  width: number;
  height: number;
  centerLat: number;
  centerLng: number;
  authorizationStatus: string;
  sourceNote: string;
  dataSource: 'api' | 'fallback';
  points: ScenicMapPoint[];
}

export interface RoutePathPoint {
  xRatio: number;
  yRatio: number;
}

export interface RoutePathSegment {
  fromSpotId: string;
  toSpotId: string;
  viaSpotIds: string[];
  points: RoutePathPoint[];
  walkMinutes?: number;
  difficulty: PhysicalLevel;
  accessible: boolean;
  roadEdgeIds: string[];
  mapLengthPx: number;
}

export interface ScenicRoutePath {
  mapId: 'ling-shan' | 'nianhua-bay';
  pathComplete: boolean;
  networkVersion?: string;
  routingProfile: RoutingProfile;
  timeEstimationStatus: TimeEstimationStatus;
  calibrationConfidence: number;
  mapLengthPx: number;
  segments: RoutePathSegment[];
  missingTransitions: Array<{
    fromSpotId: string;
    toSpotId: string;
  }>;
}

export interface ChatSource {
  id: string;
  title: string;
  spotName: string;
  snippet: string;
  section?: string;
  sourceType?: 'database' | 'approved_web' | 'realtime_web' | 'document' | string;
  sourceUrl?: string;
  sourceLevel?: string;
}

export interface ChatMetrics {
  retrievalMs: number;
  llmMs: number;
  ttsMs: number;
  totalMs: number;
  cacheHit: boolean;
  degraded: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: number;
  sources?: ChatSource[];
  audioUrl?: string;
  ttsJobId?: string;
  ttsStatus?: 'pending' | 'ready' | 'failed' | 'disabled';
  isFallback?: boolean;
  metrics?: ChatMetrics;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  audioUrl?: string;
  ttsJobId?: string;
  ttsStatus?: 'pending' | 'ready' | 'failed' | 'disabled';
  sessionId?: string;
  isFallback?: boolean;
  metrics?: ChatMetrics;
  error?: ApiError;
}

export interface ChatRequest {
  question: string;
  sessionId?: string;
  preference?: string;
  spotId?: string;
  currentSpotName?: string;
}
