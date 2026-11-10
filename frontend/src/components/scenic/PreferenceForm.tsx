import { Alert, Button, Card, Checkbox, Form, Radio, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { RoutePreferenceInput } from '../../types/scenic';

export interface PreferenceFormProps {
  initialValues: RoutePreferenceInput;
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  onSubmit: (values: RoutePreferenceInput) => void;
}

const durationOptions = [
  { value: 60, label: '1 小时' },
  { value: 90, label: '1.5 小时' },
  { value: 120, label: '2 小时' },
  { value: 180, label: '3 小时' },
];

const interestOptions = [
  '佛教文化',
  '建筑艺术',
  '演艺亲子',
  '摄影打卡',
  '自然休闲',
  '室内体验',
];

const mapLabels: Record<RoutePreferenceInput['mapId'], string> = {
  'ling-shan': '灵山胜境',
  'nianhua-bay': '拈花湾',
};

const physicalLabels: Record<RoutePreferenceInput['physicalLevel'], string> = {
  low: '低强度',
  medium: '中等强度',
  high: '高强度',
};

export default function PreferenceForm({
  initialValues,
  loading = false,
  disabled = false,
  error,
  onSubmit,
}: PreferenceFormProps) {
  const [form] = Form.useForm<RoutePreferenceInput>();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const watchedMapId = Form.useWatch('mapId', form);
  const watchedDurationMinutes = Form.useWatch('durationMinutes', form);
  const watchedPhysicalLevel = Form.useWatch('physicalLevel', form);
  const watchedInterestTags = Form.useWatch('interestTags', form);

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  const preferenceSummary = useMemo(() => {
    const mapId = watchedMapId ?? initialValues.mapId;
    const durationMinutes = watchedDurationMinutes ?? initialValues.durationMinutes ?? 120;
    const physicalLevel = watchedPhysicalLevel ?? initialValues.physicalLevel;
    const interestTags = watchedInterestTags ?? initialValues.interestTags ?? [];
    const interestText = interestTags?.length ? interestTags.join(' / ') : '未选择主题';

    return [
      mapLabels[mapId],
      `${Math.round(durationMinutes / 60 * 10) / 10} 小时`,
      physicalLabels[physicalLevel],
      interestText,
    ].join(' · ');
  }, [
    initialValues.durationMinutes,
    initialValues.interestTags,
    initialValues.mapId,
    initialValues.physicalLevel,
    watchedDurationMinutes,
    watchedInterestTags,
    watchedMapId,
    watchedPhysicalLevel,
  ]);

  const normalizePreference = (values: Partial<RoutePreferenceInput>): RoutePreferenceInput => ({
    mapId: values.mapId ?? initialValues.mapId,
    durationMinutes: values.durationMinutes ?? initialValues.durationMinutes ?? 120,
    physicalLevel: values.physicalLevel ?? initialValues.physicalLevel,
    interestTags: values.interestTags?.length ? values.interestTags : (initialValues.interestTags ?? []),
  });

  return (
    <Card className="preference-card">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div className="preference-card-header">
          <div>
            <Typography.Title level={3} style={{ marginTop: 0 }}>
              游览偏好
            </Typography.Title>
          </div>
          <button
            className="preference-toggle-button"
            type="button"
            aria-expanded={preferencesOpen}
            aria-label={preferencesOpen ? '收起游览偏好' : '展开游览偏好'}
            onClick={() => setPreferencesOpen((current) => !current)}
          >
            {preferencesOpen ? '收起' : '展开'}
          </button>
        </div>
        {error ? <Alert type="warning" showIcon message="路线推荐异常" description={error} /> : null}
        <div
          className="preference-summary-card"
        >
          <span>
            <strong>当前偏好</strong>
            <small>{preferenceSummary}</small>
          </span>
        </div>
        <Form
          form={form}
          disabled={disabled || loading}
          layout="vertical"
          initialValues={initialValues}
          className={preferencesOpen ? 'preference-form preference-form-open' : 'preference-form preference-form-compact'}
          onFinish={(values) => onSubmit(normalizePreference(values))}
        >
          <div className={preferencesOpen ? 'preference-fields preference-fields-open' : 'preference-fields preference-fields-collapsed'}>
            <Form.Item<RoutePreferenceInput>
              name="mapId"
              label="游览景区"
              rules={[{ required: true, message: '请选择游览景区' }]}
            >
              <Radio.Group>
                <Radio.Button value="ling-shan">灵山胜境</Radio.Button>
                <Radio.Button value="nianhua-bay">拈花湾</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item<RoutePreferenceInput> name="durationMinutes" label="可游览时间">
              <Select popupClassName="route-duration-dropdown" options={durationOptions} />
            </Form.Item>
            <Form.Item<RoutePreferenceInput> name="physicalLevel" label="步行强度">
              <Radio.Group>
                <Radio.Button value="low">低</Radio.Button>
                <Radio.Button value="medium">中</Radio.Button>
                <Radio.Button value="high">高</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item<RoutePreferenceInput>
              name="interestTags"
              label="兴趣主题（选择 1–2 项）"
              rules={[
                { required: true, message: '请至少选择一个兴趣主题' },
                {
                  validator: (_, value: string[] | undefined) =>
                    !value || value.length <= 2
                      ? Promise.resolve()
                      : Promise.reject(new Error('最多选择两个兴趣主题')),
                },
              ]}
            >
              <Checkbox.Group options={interestOptions} />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit" loading={loading}>
            生成推荐路线
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
