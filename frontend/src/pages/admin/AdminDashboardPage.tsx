import {
  DashboardOutlined,
  MessageOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Bar, Column, Heatmap, Line, Pie } from '@ant-design/charts';
import { Alert, Button, Card, Col, Empty, Row, Segmented, Space, Statistic, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { getAdminDashboardBase, getOperationsOverview, getVisitorInsightsReport } from '../../api';
import { toApiError } from '../../api/client';
import type { AdminDashboardData, OperationsOverview, VisitorInsightsReport } from '../../types/api';

const preferenceLabelMap: Record<string, string> = {
  culture: '佛教文化',
  building: '建筑艺术',
  family: '演艺亲子',
  photo: '摄影打卡',
  relaxed: '自然休闲',
  indoor: '室内体验',
};

const preferenceChartColors = [
  '#1f8a83',
  '#6aa785',
  '#c69a3a',
  '#8ea6c4',
  '#8f9d95',
  '#7e8fc7',
  '#b07d62',
  '#9b87a8',
];

const dashboardChartTextColor = '#1f2320';
const dashboardChartMutedColor = '#3f4641';
const dashboardChartGridColor = 'rgba(31, 35, 32, 0.12)';
const dashboardChartAxisColor = 'rgba(31, 35, 32, 0.24)';

const dashboardAxisBase = {
  title: false,
  labelFill: dashboardChartMutedColor,
  labelOpacity: 1,
  labelFontSize: 12,
  labelFontWeight: 500,
  line: true,
  lineStroke: dashboardChartAxisColor,
  lineStrokeOpacity: 1,
  tickStroke: dashboardChartAxisColor,
  tickOpacity: 1,
};

const dashboardGridAxis = {
  ...dashboardAxisBase,
  grid: true,
  gridStroke: dashboardChartGridColor,
  gridStrokeOpacity: 1,
  gridLineWidth: 1,
};

const dashboardValueLabelStyle = {
  fill: dashboardChartTextColor,
  stroke: 'rgba(254, 253, 251, 0.92)',
  lineWidth: 3,
  fontSize: 13,
  fontWeight: 700,
  paintOrder: 'stroke',
};

const dashboardHeatmapColors = ['#d9f0e8', '#8cd2bf', '#39aa95', '#0f7a71', '#043f3e'];
const qaPeakVisibleHourStart = 8;
const qaPeakVisibleHourEnd = 18;
const qaPeakVisibleHourLabels = Array.from(
  { length: qaPeakVisibleHourEnd - qaPeakVisibleHourStart + 1 },
  (_, index) => `${String(qaPeakVisibleHourStart + index).padStart(2, '0')}:00`,
);

function getDashboardHeatmapCellColor(count: number, maxCount: number): string {
  if (count <= 0 || maxCount <= 0) {
    return '#eef7f2';
  }

  const ratio = Math.min(1, Math.max(0, count / maxCount));
  if (ratio >= 0.86) {
    return dashboardHeatmapColors[4];
  }
  if (ratio >= 0.68) {
    return dashboardHeatmapColors[3];
  }
  if (ratio >= 0.5) {
    return dashboardHeatmapColors[2];
  }
  if (ratio >= 0.32) {
    return dashboardHeatmapColors[1];
  }
  return dashboardHeatmapColors[0];
}

type InsightSummaryLine = {
  id: string;
  kind: 'paragraph' | 'section' | 'item' | 'subitem';
  label?: string;
  text: string;
};

export type DashboardView = 'charts' | 'hot-questions' | 'visitor-insights';

interface AdminDashboardPageProps {
  view?: DashboardView;
}

function splitInsightLabel(text: string): { label?: string; text: string } {
  const separatorIndex = text.search(/[：:]/);
  const hasLabel = separatorIndex > 0 && separatorIndex <= 18;
  if (!hasLabel) {
    return { text };
  }
  return {
    label: text.slice(0, separatorIndex).trim(),
    text: text.slice(separatorIndex + 1).trim(),
  };
}

function formatInsightSummary(summary?: string): InsightSummaryLine[] {
  const raw = summary?.trim();
  if (!raw) {
    return [];
  }

  const lines = raw
    .replace(/^本次共分析\s*\d+\s*条游客问答记录。\s*/, '')
    .replace(/^当前时间范围内共分析\s*\d+\s*条游客问答记录，?报告由本地规则生成。?\s*/, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/管理摘要如下：\s*\*\*([^*]+)\*\*/g, '管理摘要如下：\n## $1：')
    .replace(/\s*(\d+)\.\s*\*\*([^*]+)\*\*[:：]?\s*/g, '\n$1. $2：')
    .replace(/\s*\*\s*\*\*([^*]+)\*\*[:：]?\s*/g, '\n- $1：')
    .replace(/。\s*\*\*([^*]{2,20})\*\*[:：]?\s*/g, '。\n## $1：')
    .replace(/\s+\*\s+/g, '\n- ')
    .replace(/\*\*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let insideOrderedSection = false;
  return lines.map((line, index) => {
    const isSection = line.startsWith('## ');
    const ordered = line.match(/^(\d+\.)\s*(.+)$/);
    const isBullet = /^[-*]\s+/.test(line);
    const normalized = line.replace(/^##\s*/, '').replace(/^[-*]\s+/, '').trim();
    const text = ordered ? ordered[2].trim() : normalized;
    const parts = splitInsightLabel(text);

    let kind: InsightSummaryLine['kind'] = 'item';
    if (index === 0 && !isSection && !ordered && !isBullet) {
      kind = 'paragraph';
      insideOrderedSection = false;
    } else if (isSection) {
      kind = 'section';
      insideOrderedSection = false;
    } else if (ordered) {
      kind = 'item';
      insideOrderedSection = true;
    } else if (isBullet && insideOrderedSection) {
      kind = 'subitem';
    } else if (isBullet) {
      kind = 'item';
    }

    return {
      id: `${index}-${text.slice(0, 12)}`,
      kind,
      label: parts.label,
      text: parts.text,
    };
  });
}

export default function AdminDashboardPage({ view = 'charts' }: AdminDashboardPageProps) {
  type DashboardRange = NonNullable<AdminDashboardData['operationsOverview']>['range'];
  const [messageApi, contextHolder] = message.useMessage();
  const [dashboardData, setDashboardData] = useState<AdminDashboardData | null>(null);
  const [operationsOverview, setOperationsOverview] = useState<OperationsOverview | undefined>();
  const [sevenDayOverview, setSevenDayOverview] = useState<OperationsOverview | undefined>();
  const [visitorInsightsReport, setVisitorInsightsReport] = useState<VisitorInsightsReport | undefined>();
  const [range, setRange] = useState<DashboardRange>('7d');
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [operationsError, setOperationsError] = useState('');
  const [insightsError, setInsightsError] = useState('');

  const data = useMemo<AdminDashboardData | null>(
    () =>
      dashboardData
        ? {
            ...dashboardData,
            operationsOverview,
            visitorInsightsReport,
          }
        : null,
    [dashboardData, operationsOverview, visitorInsightsReport],
  );
  const loading = dashboardLoading || operationsLoading || insightsLoading;

  const preferenceChartData = useMemo(
    () =>
      (data?.preferenceDistribution ?? []).map((item) => ({
        label: preferenceLabelMap[item.label] ?? item.label,
        count: item.count,
      })),
    [data],
  );
  const preferenceTotal = useMemo(
    () => preferenceChartData.reduce((total, item) => total + item.count, 0),
    [preferenceChartData],
  );
  const feedbackTrendData = useMemo(
    () =>
      (data?.operationsOverview?.sentimentTrend ?? []).flatMap((item) => [
        { date: item.date, tendency: '咨询类', count: item.consultation },
        { date: item.date, tendency: '投诉/风险类', count: item.risk },
        { date: item.date, tendency: '表扬/满意类', count: item.praise },
        { date: item.date, tendency: '不确定', count: item.uncertain },
      ]),
    [data],
  );
  const topSpotTotal = useMemo(
    () => (data?.topSpots ?? []).reduce((total, item) => total + item.count, 0),
    [data],
  );
  const topSpotRankData = useMemo(
    () =>
      [...(data?.topSpots ?? [])]
        .sort((left, right) => right.count - left.count)
        .slice(0, 5)
        .map((item) => ({
          spotName: item.spotName,
          count: item.count,
          share: topSpotTotal ? Number(((item.count / topSpotTotal) * 100).toFixed(1)) : 0,
          shareLabel: topSpotTotal ? `${((item.count / topSpotTotal) * 100).toFixed(1)}%` : '0%',
        })),
    [data, topSpotTotal],
  );
  const qaPeakHeatmapData = useMemo(
    () =>
      [...(data?.qaHourlyHeatmap ?? [])]
        .filter((item) => item.hour >= qaPeakVisibleHourStart && item.hour <= qaPeakVisibleHourEnd)
        .sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour)
        .map((item) => ({
          date: item.date,
          dateLabel: item.date.slice(5),
          hour: item.hour,
          hourLabel: `${String(item.hour).padStart(2, '0')}:00`,
          count: item.count,
        })),
    [data],
  );
  const hasQaPeakHeatmapData = useMemo(
    () => qaPeakHeatmapData.some((item) => item.count > 0),
    [qaPeakHeatmapData],
  );
  const qaPeakDateLabels = useMemo(
    () => Array.from(new Set(qaPeakHeatmapData.map((item) => item.dateLabel))),
    [qaPeakHeatmapData],
  );
  const qaPeakHourLabels = useMemo(
    () => qaPeakVisibleHourLabels,
    [],
  );
  const qaPeakMaxCount = useMemo(
    () => Math.max(1, ...qaPeakHeatmapData.map((item) => item.count)),
    [qaPeakHeatmapData],
  );
  const questionTopicSource = useMemo(() => {
    const insightTopics = data?.visitorInsightsReport?.concernTopics ?? [];
    if (insightTopics.length > 0) {
      return insightTopics.map((item) => ({ topic: item.topic, count: item.count }));
    }
    return data?.topicRank ?? [];
  }, [data]);
  const questionTopicTotal = useMemo(
    () => questionTopicSource.reduce((total, item) => total + item.count, 0),
    [questionTopicSource],
  );
  const questionTopicRankData = useMemo(
    () =>
      [...questionTopicSource]
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count)
        .slice(0, 5)
        .map((item) => ({
          topic: item.topic,
          count: item.count,
          share: questionTopicTotal ? Number(((item.count / questionTopicTotal) * 100).toFixed(1)) : 0,
          shareLabel: questionTopicTotal ? `${((item.count / questionTopicTotal) * 100).toFixed(1)}%` : '0%',
        })),
    [questionTopicSource, questionTopicTotal],
  );
  const insightSummaryLines = useMemo(
    () => formatInsightSummary(visitorInsightsReport?.report.summary),
    [visitorInsightsReport?.report.summary],
  );
  const loadDashboard = (nextRange = range) => {
    setDashboardLoading(true);
    setDashboardError('');
    getAdminDashboardBase(nextRange)
      .then(setDashboardData)
      .catch((err) => {
        const apiError = toApiError(err);
        setDashboardError(apiError.message);
        messageApi.error(apiError.message);
      })
      .finally(() => setDashboardLoading(false));
  };

  const loadOperations = (nextRange = range) => {
    setOperationsLoading(true);
    setOperationsError('');
    const overviewRequest = getOperationsOverview(nextRange);
    const sevenDayRequest = nextRange === '7d' ? overviewRequest : getOperationsOverview('7d');
    Promise.all([overviewRequest, sevenDayRequest])
      .then(([overview, sevenDay]) => {
        setOperationsOverview(overview);
        setSevenDayOverview(sevenDay);
      })
      .catch((err) => {
        const apiError = toApiError(err);
        setOperationsError(apiError.message);
        messageApi.error(apiError.message);
      })
      .finally(() => setOperationsLoading(false));
  };

  const loadInsights = (nextRange = range, options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setInsightsLoading(true);
    }
    setInsightsError('');
    getVisitorInsightsReport(nextRange)
      .then(setVisitorInsightsReport)
      .catch((err) => {
        const apiError = toApiError(err);
        setInsightsError(apiError.message);
        messageApi.error(apiError.message);
      })
      .finally(() => {
        if (!options.silent) {
          setInsightsLoading(false);
        }
      });
  };

  const loadAll = (nextRange = range) => {
    loadDashboard(nextRange);
    loadOperations(nextRange);
    loadInsights(nextRange);
  };

  useEffect(() => {
    loadDashboard(range);
    loadOperations(range);
    loadInsights(range);
  }, [range]);

  useEffect(() => {
    if (visitorInsightsReport?.report.llmStatus !== 'pending') {
      return undefined;
    }
    const timer = window.setTimeout(() => loadInsights(range, { silent: true }), 5000);
    return () => window.clearTimeout(timer);
  }, [range, visitorInsightsReport?.report.llmStatus, visitorInsightsReport?.report.summary]);

  const questionColumns: ColumnsType<AdminDashboardData['topQuestions'][number]> = [
    {
      title: '',
      dataIndex: 'question',
      ellipsis: true,
    },
    {
      title: '次数',
      dataIndex: 'count',
      width: 80,
      render: (value: number) => <Tag color="green">{value}</Tag>,
    },
  ];

  const summary = data?.summary;
  const qaTrendTitle =
    range === 'today'
      ? '今日问答量'
      : range === '30d'
        ? '近 30 天问答量'
        : range === 'week'
          ? '本周问答量'
          : '近 7 天问答量';
  const insightRangeLabel =
    range === 'today' ? '今日' : range === '30d' ? '近 30 天' : range === 'week' ? '本周' : '近 7 天';
  const insightQuestionCount =
    visitorInsightsReport?.totalQuestions ?? operationsOverview?.summary.rangeQuestions ?? 0;
  return (
    <div className="admin-page">
      {contextHolder}
      <div className="admin-toolbar">
        <Space className="admin-toolbar-actions" wrap>
          <Segmented
            value={range}
            onChange={(value) => setRange(value as DashboardRange)}
            options={[
              { label: '今日', value: 'today' },
              { label: '近 7 天', value: '7d' },
              { label: '近 30 天', value: '30d' },
            ]}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => loadAll(range)}>
            刷新
          </Button>
        </Space>
      </div>

      {dashboardError ? <Alert type="warning" showIcon message="基础看板加载失败" description={dashboardError} /> : null}
      {operationsError ? <Alert type="warning" showIcon message="运营趋势加载失败" description={operationsError} /> : null}
      {insightsError ? <Alert type="warning" showIcon message="游客洞察加载失败" description={insightsError} /> : null}

      {view === 'charts' ? (
        <>
          <div className="dashboard-summary-grid">
            <div className="dashboard-summary-group">
              <Card className="dashboard-summary-card" loading={dashboardLoading}>
                <Statistic title="今日问答" value={summary?.todayQuestions ?? 0} suffix="条" prefix={<DashboardOutlined />} />
              </Card>
              <Card className="dashboard-summary-card" loading={operationsLoading}>
                <Statistic
                  title="今日服务人次"
                  value={operationsOverview?.summary.todayServiceSessions ?? 0}
                  suffix="人次"
                  prefix={<TeamOutlined />}
                />
              </Card>
            </div>
            <div className="dashboard-summary-group">
              <Card className="dashboard-summary-card" loading={operationsLoading}>
                <Statistic
                  title="近 7 天问答量"
                  value={sevenDayOverview?.summary.rangeQuestions ?? 0}
                  suffix="条"
                  prefix={<MessageOutlined />}
                />
              </Card>
              <Card className="dashboard-summary-card" loading={operationsLoading}>
                <Statistic
                  title="近 7 天服务人次"
                  value={sevenDayOverview?.summary.rangeServiceSessions ?? 0}
                  suffix="人次"
                  prefix={<TeamOutlined />}
                />
              </Card>
            </div>
            <div className="dashboard-summary-group dashboard-summary-group--total">
              <Card className="dashboard-summary-card" loading={dashboardLoading}>
                <Statistic title="累计问答" value={summary?.totalQuestions ?? 0} suffix="条" prefix={<MessageOutlined />} />
              </Card>
            </div>
          </div>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="游客反馈倾向趋势" loading={operationsLoading}>
                {feedbackTrendData.length ? (
                  <div
                    className="dashboard-chart"
                    data-testid="sentiment-trend-chart"
                    role="img"
                    aria-label="游客反馈倾向趋势堆叠柱状图"
                  >
                    <div className="dashboard-chart-legend" aria-hidden="true">
                      <span><i style={{ background: '#3b82f6' }} />咨询类</span>
                      <span><i style={{ background: '#d96666' }} />投诉/风险类</span>
                      <span><i style={{ background: '#2f855a' }} />表扬/满意类</span>
                      <span><i style={{ background: '#94a3b8' }} />不确定</span>
                    </div>
                    <Column
                      data={feedbackTrendData}
                      xField="date"
                      yField="count"
                      colorField="tendency"
                      stack
                      height={248}
                      autoFit
                      scale={{
                        color: {
                          domain: ['咨询类', '投诉/风险类', '表扬/满意类', '不确定'],
                          range: ['#3b82f6', '#d96666', '#2f855a', '#94a3b8'],
                        },
                        y: { domainMin: 0, nice: true },
                      }}
                      axis={{
                        x: { ...dashboardAxisBase, labelFormatter: (value: string) => value.slice(5) },
                        y: dashboardGridAxis,
                      }}
                      legend={false}
                      tooltip={{ items: [{ field: 'count', name: '问答量' }] }}
                    />
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无反馈倾向趋势数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="热门景点关注排行" loading={dashboardLoading}>
                {topSpotRankData.length ? (
                  <div
                    className="dashboard-chart"
                    data-testid="top-spot-rank-chart"
                    role="img"
                    aria-label="热门景点关注排行横向条形图"
                  >
                    <Bar
                      data={topSpotRankData}
                      xField="spotName"
                      yField="count"
                      height={280}
                      autoFit
                      colorField="spotName"
                      scale={{
                        color: {
                          range: ['#5fa391', '#4b958f', '#3f817c', '#356d6f', '#2d5f66'],
                        },
                        y: { domainMin: 0, nice: true },
                      }}
                      axis={{
                        x: dashboardAxisBase,
                        y: dashboardGridAxis,
                      }}
                      legend={false}
                      label={{
                        text: 'count',
                        position: 'right',
                        style: dashboardValueLabelStyle,
                      }}
                      style={{ radius: 4, maxWidth: 24 }}
                      tooltip={{
                        title: 'spotName',
                        items: [
                          { field: 'count', name: '命中次数' },
                          { field: 'shareLabel', name: '占比' },
                        ],
                      }}
                    />
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无热门景点关注数据" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title={qaTrendTitle} loading={dashboardLoading}>
                {data?.qaTrend.length ? (
                  <div
                    className="dashboard-chart"
                    data-testid="qa-trend-chart"
                    role="img"
                    aria-label="最近 7 天问答量趋势图"
                  >
                    <Line
                      data={data.qaTrend}
                      xField="date"
                      yField="count"
                      height={280}
                      autoFit
                      smooth
                      point={{ size: 4, shape: 'circle' }}
                      scale={{ y: { domainMin: 0, nice: true } }}
                      axis={{
                        x: { ...dashboardAxisBase, labelFormatter: (value: string) => value.slice(5) },
                        y: dashboardGridAxis,
                      }}
                      tooltip={{ items: [{ field: 'count', name: '问答量' }] }}
                      style={{ stroke: '#16776f', lineWidth: 3 }}
                    />
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无问答趋势数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="游客偏好分布" loading={dashboardLoading}>
                {preferenceChartData.length ? (
                  <div
                    className="dashboard-chart dashboard-preference-chart"
                    data-testid="preference-distribution-chart"
                    role="img"
                    aria-label="游客偏好分布环形图"
                  >
                    <div className="dashboard-donut-wrap">
                      <Pie
                        data={preferenceChartData}
                        angleField="count"
                        colorField="label"
                        innerRadius={0.64}
                        height={240}
                        autoFit
                        scale={{ color: { range: preferenceChartColors } }}
                        legend={false}
                        tooltip={{ items: [{ field: 'count', name: '数量' }] }}
                        style={{ stroke: '#ffffff', lineWidth: 2 }}
                      />
                      <div className="dashboard-donut-total" aria-hidden="true">
                        <strong>{preferenceTotal}</strong>
                        <span>偏好记录</span>
                      </div>
                    </div>
                    <div className="dashboard-preference-legend">
                      {preferenceChartData.map((item, index) => (
                        <div key={item.label}>
                          <i style={{ background: ['#16776f', '#5ca88e', '#c7922e', '#94a3b8', '#7c8a86'][index % 5] }} />
                          <span>
                            {item.label} {item.count}（{Math.round((item.count / preferenceTotal) * 100)}%）
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无游客偏好数据" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="问答高峰时段热力图" loading={dashboardLoading}>
                {hasQaPeakHeatmapData ? (
                  <div
                    className="dashboard-chart"
                    data-testid="qa-peak-heatmap-chart"
                    role="img"
                    aria-label="问答高峰时段热力图"
                  >
                    <Heatmap
                      data={qaPeakHeatmapData}
                      xField="dateLabel"
                      yField="hourLabel"
                      colorField="count"
                      mark="cell"
                      height={280}
                      autoFit
                      scale={{
                        color: {
                          domain: [0, qaPeakMaxCount],
                          range: dashboardHeatmapColors,
                        },
                        x: { domain: qaPeakDateLabels },
                        y: { domain: qaPeakHourLabels },
                      }}
                      axis={{
                        x: dashboardGridAxis,
                        y: dashboardGridAxis,
                      }}
                      legend={false}
                      style={{
                        fill: (item: { count: number }) => getDashboardHeatmapCellColor(item.count, qaPeakMaxCount),
                        fillOpacity: 1,
                        stroke: 'rgba(254, 253, 251, 0.86)',
                        lineWidth: 1,
                        inset: 1,
                        radius: 3,
                      }}
                      tooltip={{
                        title: (item: { dateLabel: string; hourLabel: string }) => `${item.dateLabel} ${item.hourLabel}`,
                        items: [{ field: 'count', name: '问答量' }],
                      }}
                    />
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无问答高峰时段数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="热门问题类型排行" loading={dashboardLoading || insightsLoading}>
                {questionTopicRankData.length ? (
                  <div
                    className="dashboard-chart"
                    data-testid="question-topic-rank-chart"
                    role="img"
                    aria-label="热门问题类型排行横向条形图"
                  >
                    <Bar
                      data={questionTopicRankData}
                      xField="topic"
                      yField="count"
                      height={280}
                      autoFit
                      colorField="topic"
                      scale={{
                        color: {
                          range: ['#5fa391', '#4b958f', '#3f817c', '#356d6f', '#2d5f66'],
                        },
                        y: { domainMin: 0, nice: true },
                      }}
                      axis={{
                        x: dashboardAxisBase,
                        y: dashboardGridAxis,
                      }}
                      legend={false}
                      label={{
                        text: 'count',
                        position: 'right',
                        style: dashboardValueLabelStyle,
                      }}
                      style={{ radius: 4, maxWidth: 24 }}
                      tooltip={{
                        title: 'topic',
                        items: [
                          { field: 'count', name: '问答量' },
                          { field: 'shareLabel', name: '占比' },
                        ],
                      }}
                    />
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无热门问题类型数据" />
                )}
              </Card>
            </Col>
          </Row>
        </>
      ) : null}

      {view === 'hot-questions' ? (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card className="admin-table-card" title="热门问题" extra={<span className="admin-table-card__count-title">次数</span>}>
              <Table
                rowKey="question"
                loading={dashboardLoading}
                columns={questionColumns}
                dataSource={data?.topQuestions ?? []}
                pagination={false}
                showHeader={false}
                size="middle"
              />
            </Card>
          </Col>
        </Row>
      ) : null}

      {view === 'visitor-insights' ? (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card title="游客关注点分析" loading={insightsLoading}>
              {insightSummaryLines.length || insightQuestionCount > 0 ? (
                <div className="dashboard-insight-report">
                  <div className="dashboard-insight-report__lead">
                    {insightRangeLabel}共分析 {insightQuestionCount} 条游客问答记录。
                  </div>
                  {insightSummaryLines.map((line) => (
                    <div
                      key={line.id}
                      className={`dashboard-insight-report__${line.kind}`}
                    >
                      {line.label ? <strong>{line.label}</strong> : null}
                      <span>{line.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围内暂无游客交互记录" />
              )}
            </Card>
          </Col>
        </Row>
      ) : null}
    </div>
  );
}
