import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAdmin, saveAdminToken } from '../../api/auth';
import { toApiError } from '../../api/client';

interface AdminLoginValues {
  username: string;
  password: string;
}

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<AdminLoginValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFinish(values: AdminLoginValues) {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const response = await loginAdmin(values);
      saveAdminToken(response.token);
      navigate('/dashboard/charts', { replace: true });
    } catch (error) {
      const apiError = toApiError(error, '登录失败，请稍后重试。');
      setErrorMessage(apiError.message);
      form.setFields([{ name: 'password', errors: [apiError.message] }]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-shell">
        <div className="admin-login-copy">
          <Typography.Text className="admin-login-kicker">[ OPS CONTROL ]</Typography.Text>
          <Typography.Title level={1}>运营控制台</Typography.Title>
          <Typography.Paragraph>景区资料库、问答日志与知识审核入口。</Typography.Paragraph>
        </div>
        <Card className="admin-login-card">
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <div>
              <Typography.Text className="admin-login-kicker">[ OPS LOGIN ]</Typography.Text>
              <Typography.Title level={1}>管理端登录</Typography.Title>
              <Typography.Paragraph type="secondary">景区资料库与问答运营控制台</Typography.Paragraph>
            </div>
            {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}
            <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish}>
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入管理员用户名' }]}>
                <Input autoComplete="username" prefix={<UserOutlined />} placeholder="admin" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入管理员密码' }]}>
                <Input.Password autoComplete="current-password" prefix={<LockOutlined />} placeholder="请输入密码" />
              </Form.Item>
              <Button block type="primary" htmlType="submit" loading={submitting} disabled={submitting}>
                [ 登录 ]
              </Button>
            </Form>
          </Space>
        </Card>
      </section>
    </main>
  );
}
