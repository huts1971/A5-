import { requestJson } from './client';
import { USE_MOCK_API } from './config';
import type { AdminDashboardData, BehaviorSummary } from '../types/api';

const wait = (ms = 220) => new Promise((resolve) => window.setTimeout(resolve, ms));

interface BackendAdminDashboardData {
  summary: {
    total_questions: number;
    today_questions: number;
    spot_count: number;
    route_count: number;
    knowledge_doc_count: number;
    knowledge_chunk_count: number;
    degraded_count: number;
    avg_total_ms: number;
  };
  top_questions: Array<{ question: string; count: number }>;
  top_spots: Array<{ spot_name: string; count: number }>;
  preference_distribution: Array<{ label: string; count: number }>;
  qa_trend: Array<{ date: string; count: number }>;
  recent_logs: Array<{
    id: number;
    question: string;
    answer: string;
    source_count: number;
    created_at: string;
  }>;
  behavior_summary?: BackendBehaviorSummary;
}

interface BackendBehaviorSummary {
  source_file?: string;
  generated_at?: string;
  record_count: number;
  field_count?: number;
  usage_note: string;
  overall: {
    avg_stay_duration?: number;
    avg_total_cost?: number;
    avg_ticket_cost?: number;
    avg_food_cost?: number;
    avg_shopping_cost?: number;
    avg_transport_cost?: number;
    avg_entertainment_cost?: number;
    avg_group_size?: number;
    avg_satisfaction?: number;
  };
  gender_distribution: Array<{ label: string; count: number }>;
  age_distribution: Array<{ label: string; count: number }>;
  attraction_type_distribution: Array<{ label: string; count: number }>;
  top_attractions?: Array<{ label: string; count: number }>;
  satisfaction_distribution?: Array<{ label: string; count: number }>;
  peak_months?: Array<{ label: string; count: number }>;
  type_behavior: Array<{
    label: string;
    count: number;
    avg_stay_duration: number;
    avg_total_cost: number;
    avg_satisfaction: number;
  }>;
  insights: string[];
}

function mapBehaviorSummary(summary?: BackendBehaviorSummary): BehaviorSummary | undefined {
  if (!summary) {
    return undefined;
  }

  return {
    sourceFile: summary.source_file,
    generatedAt: summary.generated_at,
    recordCount: summary.record_count,
    fieldCount: summary.field_count,
    usageNote: summary.usage_note,
    overall: {
      avgStayDuration: summary.overall.avg_stay_duration,
      avgTotalCost: summary.overall.avg_total_cost,
      avgTicketCost: summary.overall.avg_ticket_cost,
      avgFoodCost: summary.overall.avg_food_cost,
      avgShoppingCost: summary.overall.avg_shopping_cost,
      avgTransportCost: summary.overall.avg_transport_cost,
      avgEntertainmentCost: summary.overall.avg_entertainment_cost,
      avgGroupSize: summary.overall.avg_group_size,
      avgSatisfaction: summary.overall.avg_satisfaction,
    },
    genderDistribution: summary.gender_distribution ?? [],
    ageDistribution: summary.age_distribution ?? [],
    attractionTypeDistribution: summary.attraction_type_distribution ?? [],
    topAttractions: summary.top_attractions ?? [],
    satisfactionDistribution: summary.satisfaction_distribution ?? [],
    peakMonths: summary.peak_months ?? [],
    typeBehavior: (summary.type_behavior ?? []).map((item) => ({
      label: item.label,
      count: item.count,
      avgStayDuration: item.avg_stay_duration,
      avgTotalCost: item.avg_total_cost,
      avgSatisfaction: item.avg_satisfaction,
    })),
    insights: summary.insights ?? [],
  };
}

const mockDashboard: AdminDashboardData = {
  summary: {
    totalQuestions: 38,
    todayQuestions: 6,
    spotCount: 24,
    routeCount: 4,
    knowledgeDocCount: 28,
    knowledgeChunkCount: 184,
    degradedCount: 1,
    avgTotalMs: 860,
  },
  topQuestions: [
    { question: '两个小时怎么游览灵山胜境？', count: 8 },
    { question: '灵山大佛有哪些看点？', count: 7 },
    { question: '带老人来怎么安排路线？', count: 5 },
  ],
  topSpots: [
    { spotName: '灵山大佛', count: 13 },
    { spotName: '灵山梵宫', count: 9 },
    { spotName: '九龙灌浴', count: 6 },
  ],
  preferenceDistribution: [
    { label: 'culture', count: 16 },
    { label: 'family', count: 12 },
    { label: 'photo', count: 7 },
    { label: '未标注', count: 3 },
  ],
  qaTrend: [
    { date: '2026-05-29', count: 2 },
    { date: '2026-05-30', count: 4 },
    { date: '2026-05-31', count: 3 },
    { date: '2026-06-01', count: 7 },
    { date: '2026-06-02', count: 6 },
    { date: '2026-06-03', count: 10 },
    { date: '2026-06-04', count: 6 },
  ],
  recentLogs: [
    {
      id: 'mock-log-1',
      question: '灵山梵宫适合拍照吗？',
      answer: '适合，但部分区域需要遵守现场拍摄提示。',
      sourceCount: 2,
      createdAt: '2026-06-04 10:20:00',
    },
  ],
  behaviorSummary: {
    sourceFile: '../Scenic Area Public Information Package/景点景区旅游数据行为分析数据.xlsx',
    generatedAt: '2026-06-04T00:00:00+00:00',
    recordCount: 140447,
    fieldCount: 17,
    usageNote: 'Excel 行为数据不进入 RAG 问答知识库；本摘要用于后台运营看板、游客画像说明和路线推荐依据展示。',
    overall: {
      avgStayDuration: 4.23,
      avgTotalCost: 692.89,
      avgGroupSize: 2.62,
      avgSatisfaction: 3.72,
    },
    genderDistribution: [
      { label: '女', count: 70300 },
      { label: '男', count: 70147 },
    ],
    ageDistribution: [
      { label: '26-35岁', count: 42000 },
      { label: '36-45岁', count: 36000 },
      { label: '46-60岁', count: 28000 },
    ],
    attractionTypeDistribution: [
      { label: '古镇水乡', count: 31564 },
      { label: '风景名胜与休闲度假', count: 25682 },
      { label: '主题乐园', count: 17524 },
    ],
    typeBehavior: [
      {
        label: '古镇水乡',
        count: 31564,
        avgStayDuration: 3.9,
        avgTotalCost: 620.2,
        avgSatisfaction: 3.7,
      },
      {
        label: '主题乐园',
        count: 17524,
        avgStayDuration: 5.6,
        avgTotalCost: 980.4,
        avgSatisfaction: 3.8,
      },
    ],
    insights: [
      '资料包共纳入 140447 条游客行为记录，可作为游客画像和运营看板的基线数据。',
      '样本中占比最高的景区类型是“古镇水乡”，可支撑偏好分析展示。',
    ],
  },
};

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  if (USE_MOCK_API) {
    await wait();
    return mockDashboard;
  }

  const response = await requestJson<BackendAdminDashboardData>('/api/admin/dashboard');
  return {
    summary: {
      totalQuestions: response.summary.total_questions,
      todayQuestions: response.summary.today_questions,
      spotCount: response.summary.spot_count,
      routeCount: response.summary.route_count,
      knowledgeDocCount: response.summary.knowledge_doc_count,
      knowledgeChunkCount: response.summary.knowledge_chunk_count,
      degradedCount: response.summary.degraded_count,
      avgTotalMs: response.summary.avg_total_ms,
    },
    topQuestions: response.top_questions,
    topSpots: response.top_spots.map((item) => ({
      spotName: item.spot_name,
      count: item.count,
    })),
    preferenceDistribution: response.preference_distribution,
    qaTrend: response.qa_trend,
    recentLogs: response.recent_logs.map((item) => ({
      id: String(item.id),
      question: item.question,
      answer: item.answer,
      sourceCount: item.source_count,
      createdAt: item.created_at,
    })),
    behaviorSummary: mapBehaviorSummary(response.behavior_summary),
  };
}
