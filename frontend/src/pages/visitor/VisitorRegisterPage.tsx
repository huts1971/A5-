import { LockOutlined, UserAddOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerVisitor, saveVisitorToken } from '../../api/auth';
import { toApiError } from '../../api/client';
import { clearVisitorSessionState } from '../../utils/visitorSessionState';

interface AuthFormValues {
  username: string;
  password: string;
}

export default function VisitorRegisterPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<AuthFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFinish(values: AuthFormValues) {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const response = await registerVisitor(values);
      clearVisitorSessionState();
      saveVisitorToken(response.token);
      navigate('/', { replace: true });
    } catch (error) {
      const apiError = toApiError(error, '注册失败，请稍后重试。');
      setErrorMessage(apiError.message);
      const target = apiError.code?.includes('USERNAME') ? 'username' : 'password';
      form.setFields([{ name: target, errors: [apiError.message] }]);
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
          <Typography.Paragraph>创建账号后即可使用景点、路线与数字人讲解。</Typography.Paragraph>
        </div>
        <Card className="visitor-auth-card">
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <div>
              <Typography.Text className="visitor-auth-kicker">[ CREATE ACCOUNT ]</Typography.Text>
              <Typography.Title level={1}>游客注册</Typography.Title>
            </div>
            {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}
            <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish}>
              <Form.Item
                name="username"
                label="用户名"
                rules={[
                  { required: true, message: '请输入用户名' },
                  { pattern: /^[A-Za-z0-9_]{3,32}$/, message: '用户名需为 3-32 位字母、数字或下划线' },
                ]}
              >
                <Input autoComplete="username" prefix={<UserAddOutlined />} placeholder="visitor_001" />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 6, message: '密码至少 6 位' },
                  { max: 64, message: '密码最多 64 位' },
                ]}
              >
                <Input.Password autoComplete="new-password" prefix={<LockOutlined />} placeholder="请输入 6-64 位密码" />
              </Form.Item>
              <Button block type="primary" htmlType="submit" loading={submitting} disabled={submitting}>
                [ 注册 ]
              </Button>
            </Form>
            <Alert
              type="info"
              showIcon
              message={
                <span>
                  已有账号？ <Link to="/login">[ 登录 ]</Link>
                </span>
              }
            />
          </Space>
        </Card>
      </section>
    </main>
  );
}
