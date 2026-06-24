import { Alert, Button, Card, Checkbox, Form, Radio, Select, Space, Typography } from 'antd';
import { useEffect } from 'react';
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

export default function PreferenceForm({
  initialValues,
  loading = false,
  disabled = false,
  error,
  onSubmit,
}: PreferenceFormProps) {
  const [form] = Form.useForm<RoutePreferenceInput>();

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  return (
    <Card className="preference-card">
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <div>
          <Typography.Text className="mono-label">[ PREFERENCE ]</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 0 }}>
            选择你的游览偏好
          </Typography.Title>
        </div>
        {error ? <Alert type="warning" showIcon message="路线推荐异常" description={error} /> : null}
        <Form
          form={form}
          disabled={disabled || loading}
          layout="vertical"
          initialValues={initialValues}
          onFinish={onSubmit}
        >
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
            <Select options={durationOptions} />
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
          <Button type="primary" htmlType="submit" loading={loading} data-cue="[ GENERATE ]">
            [ GENERATE ROUTE ]
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
