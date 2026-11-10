export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  detail?: unknown;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'visitor' | 'admin';
}

export interface AuthResponse {
  token: string;
  tokenType: 'bearer';
  user: AuthUser;
}

export interface KnowledgeRebuildResult {
  status: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
  indexedDocs?: number;
  indexedChunks?: number;
  startedAt?: string;
}

export interface KnowledgeDocItem {
  id: string;
  title: string;
  sourceType: string;
  path: string;
  chunkCount: number;
  indexed: boolean;
}

export type WebFactCandidateStatus =
  | 'pending_review'
  | 'approved_supplemental'
  | 'approved_official'
  | 'rejected'
  | 'ignored';

export type WebFactReviewAction = 'approve_official' | 'reject' | 'ignore';

export interface WebFactCandidateUpdate {
  entityType?: string;
  entityId?: string;
  entityName?: string;
  factKey?: string;
  factValue?: string;
  sourceUrl?: string;
  sourceLevel?: string;
  question?: string;
  answerExcerpt?: string;
}

export interface WebFactCandidate {
  id: number;
  entityType: string;
  entityId: string;
  entityName: string;
  factKey: string;
  factValue: string;
  sourceUrl: string;
  sourceLevel: string;
  question: string;
  answerExcerpt: string;
  status: WebFactCandidateStatus;
  createdAt: string;
}

export interface OfficialWebFact {
  id: number;
  spotId: string;
  spotName: string;
  factKey: string;
  factLabel: string;
  factValue: string;
  sourceUrl: string;
  sourceType: string;
  updatedAt: string;
}

export interface OfficialWebFactUpdate {
  spotId?: string;
  factKey?: string;
  factValue?: string;
  sourceUrl?: string;
}

export interface ChatLogItem {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  sources: Array<{
    id?: string;
    title: string;
    spotName: string;
    section?: string;
    snippet?: string;
    sourceType?: string;
    sourceUrl?: string;
    sourceLevel?: string;
  }>;
  visitorType?: string;
  preference?: string;
  metrics?: {
    retrievalMs: number;
    llmMs: number;
    ttsMs: number;
    totalMs: number;
    cacheHit: boolean;
    degraded: boolean;
  };
  createdAt: string;
}

export interface ChatLogQuery {
  keyword?: string;
  limit?: number;
}

export interface ChatLogDeleteResult {
  status: 'deleted';
  deletedCount: number;
}

export interface UserFeedbackItem {
  id: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface UserFeedbackCreate {
  rating: number;
  content: string;
  pagePath?: string;
}

export interface AdminDashboardSummary {
  totalQuestions: number;
  todayQuestions: number;
  spotCount: number;
  routeCount: number;
  knowledgeDocCount: number;
  knowledgeChunkCount: number;
  degradedCount: number;
  avgTotalMs: number;
}

export interface OperationsOverview {
  range: 'today' | 'week' | '7d' | '30d';
  period: {
    start: string;
    end: string;
  };
  summary: {
    todayServiceSessions: number;
    weekServiceSessions: number;
    todayQuestions: number;
    weekQuestions: number;
    rangeServiceSessions: number;
    rangeQuestions: number;
    avgSatisfactionScore: number | null;
  };
  sentimentTrend: Array<{
    date: string;
    consultation: number;
    risk: number;
    praise: number;
    uncertain: number;
  }>;
  consultationTopicTrend: Array<{
    date: string;
    ticketOpening: number;
    routePlanning: number;
    locationTraffic: number;
    spotExplanation: number;
    facilities: number;
  }>;
  satisfactionTrend: Array<{
    date: string;
    avgSatisfactionScore: number | null;
  }>;
}

export interface VisitorInsightsReport {
  range: 'today' | 'week' | '7d' | '30d';
  period: {
    start: string;
    end: string;
  };
  totalQuestions: number;
  topicCategories: string[];
  popularQuestionClusters: Array<{
    clusterLabel: string;
    representativeQuestion: string;
    questions: string[];
    count: number;
    intentCategory: string;
    sentiment: 'consultation' | 'risk' | 'praise' | 'uncertain';
  }>;
  concernTopics: Array<{
    topic: string;
    count: number;
    share: number;
    feedbackTendency: {
      consultation: number;
      risk: number;
      praise: number;
      uncertain: number;
    };
    representativeQuestions: string[];
  }>;
  serviceSuggestions: Array<{
    type: 'high_frequency_topic' | 'negative_topic';
    topic: string;
    message: string;
  }>;
  report: {
    generatedBy: 'rule_based' | 'llm_enhanced';
    llmStatus: 'success' | 'skipped_no_key' | 'pending' | 'failed';
    llmError?: string;
    summary: string;
    ruleSummary: string;
  };
}

export interface BehaviorSummary {
  sourceFile?: string;
  generatedAt?: string;
  recordCount: number;
  fieldCount?: number;
  usageNote: string;
  overall: {
    avgStayDuration?: number;
    avgTotalCost?: number;
    avgTicketCost?: number;
    avgFoodCost?: number;
    avgShoppingCost?: number;
    avgTransportCost?: number;
    avgEntertainmentCost?: number;
    avgGroupSize?: number;
    avgSatisfaction?: number;
  };
  genderDistribution: Array<{
    label: string;
    count: number;
  }>;
  ageDistribution: Array<{
    label: string;
    count: number;
  }>;
  attractionTypeDistribution: Array<{
    label: string;
    count: number;
  }>;
  topAttractions?: Array<{
    label: string;
    count: number;
  }>;
  satisfactionDistribution?: Array<{
    label: string;
    count: number;
  }>;
  peakMonths?: Array<{
    label: string;
    count: number;
  }>;
  typeBehavior: Array<{
    label: string;
    count: number;
    avgStayDuration: number;
    avgTotalCost: number;
    avgSatisfaction: number;
  }>;
  insights: string[];
}

export interface AdminDashboardData {
  summary: AdminDashboardSummary;
  operationsOverview?: OperationsOverview;
  visitorInsightsReport?: VisitorInsightsReport;
  topQuestions: Array<{
    question: string;
    count: number;
  }>;
  topSpots: Array<{
    spotName: string;
    count: number;
  }>;
  preferenceDistribution: Array<{
    label: string;
    count: number;
  }>;
  qaTrend: Array<{
    date: string;
    count: number;
  }>;
  qaHourlyHeatmap: Array<{
    date: string;
    hour: number;
    count: number;
  }>;
  topicRank: Array<{
    topic: string;
    count: number;
  }>;
  recentLogs: Array<{
    id: string;
    question: string;
    answer: string;
    sourceCount: number;
    createdAt: string;
  }>;
  behaviorSummary?: BehaviorSummary;
}

export interface DigitalHumanAvatar {
  id: string;
  name: string;
  note: string;
  sourceFilename: string;
  resourceSize: number;
  isBuiltin: boolean;
  isActive: boolean;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
}

export interface DigitalHumanRuntimeConfig {
  avatarId: string;
  version: string;
  loaderUrl: string;
  dataUrl: string;
  frameworkUrl: string;
  codeUrl: string;
  streamingAssetsUrl: string;
  fallbackUrl: string;
  bridgeObjectName: string;
  expiresAt?: string;
}
