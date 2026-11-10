import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loginVisitor, saveVisitorToken } from '../../api/auth';
import { toApiError } from '../../api/client';
import { clearVisitorSessionState } from '../../utils/visitorSessionState';

interface AuthFormValues {
  username: string;
  password: string;
}

export default function VisitorLoginPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<AuthFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFinish(values: AuthFormValues) {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const response = await loginVisitor(values);
      clearVisitorSessionState();
      saveVisitorToken(response.token);
      navigate('/guide', { replace: true });
    } catch (error) {
      const apiError = toApiError(error, '登录失败，请稍后重试。');
      setErrorMessage(apiError.message);
      form.setFields([{ name: 'password', errors: [apiError.message] }]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="visitor-auth-page">
      <section className="visitor-auth-shell">
        <div className="visitor-auth-copy">
          <Typography.Text className="visitor-auth-kicker">[ LING SHAN GUIDE ]</Typography.Text>
          <Typography.Title level={1}>灵山胜境 AI 导览</Typography.Title>
          <Typography.Paragraph>登录后继续探索景点、路线与数字人讲解。</Typography.Paragraph>
        </div>
        <Card className="visitor-auth-card">
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <div>
            <Typography.Text className="visitor-auth-kicker">[ VISITOR LOGIN ]</Typography.Text>
            <Typography.Title level={1}>游客登录</Typography.Title>
          </div>
          {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish}>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input autoComplete="username" prefix={<UserOutlined />} placeholder="visitor_001" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" prefix={<LockOutlined />} placeholder="请输入密码" />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={submitting} disabled={submitting}>
              [ 登录 ]
            </Button>
          </Form>
          <Alert
            type="info"
            showIcon
            message={
              <span>
                还没有账号？ <Link to="/register">[ 创建账号 ]</Link>
              </span>
            }
          />
          </Space>
        </Card>
      </section>
    </main>
  );
}
