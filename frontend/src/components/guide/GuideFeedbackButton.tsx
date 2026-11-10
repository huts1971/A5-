import { CommentOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Rate, Space, Typography, message } from 'antd';
import { useState } from 'react';
import { submitUserFeedback } from '../../api/feedback';
import { toApiError } from '../../api/client';

export default function GuideFeedbackButton() {
  const [messageApi, contextHolder] = message.useMessage();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setRating(0);
    setContent('');
  };

  const submit = () => {
    const trimmedContent = content.trim();
    if (!rating) {
      messageApi.warning('请先选择 1-5 星评分');
      return;
    }
    if (!trimmedContent) {
      messageApi.warning('请填写反馈内容');
      return;
    }

    setSubmitting(true);
    submitUserFeedback({
      rating,
      content: trimmedContent,
      pagePath: typeof window === 'undefined' ? '/guide' : `${window.location.pathname}${window.location.search}`,
    })
      .then(() => {
        messageApi.success('反馈已提交，感谢你的建议');
        reset();
        setOpen(false);
      })
      .catch((error) => {
        messageApi.error(toApiError(error).message);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <>
      {contextHolder}
      <Button
        className="guide-feedback-fab"
        type="primary"
        icon={<CommentOutlined />}
        onClick={() => setOpen(true)}
      >
        反馈
      </Button>
      <Modal
        className="guide-feedback-bubble-modal"
        title="体验反馈"
        open={open}
        width={560}
        zIndex={1300}
        okText="提交反馈"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={submit}
        onCancel={() => {
          setOpen(false);
          reset();
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={14} className="guide-feedback-modal">
          <div>
            <Typography.Text strong>体验评分</Typography.Text>
            <div className="guide-feedback-modal__rate">
              <Rate value={rating} onChange={setRating} />
            </div>
          </div>
          <div>
            <Typography.Text strong>反馈内容</Typography.Text>
            <Input.TextArea
              value={content}
              maxLength={500}
              showCount
              rows={5}
              placeholder="可以写下回答不准确、页面不好用、语音播放异常等问题。"
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
