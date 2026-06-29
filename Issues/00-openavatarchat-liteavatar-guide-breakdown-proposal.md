# A5 `/guide` 页 OpenAvatarChat LiteAvatar 集成任务拆分提案

生成时间：2026-06-28

状态：已批准并发布

## Published Issues

1. [建立 avatar service 本地骨架与联合启动基础](./01-avatar-service-local-foundation.md)
2. [打通 `/guide` 单会话初始化、健康检查与左侧状态层](./02-guide-avatar-session-and-status.md)
3. [文字输入流式回答接入 LiteAvatar 自动播报](./03-streaming-text-to-liteavatar.md)
4. [麦克风半双工录音、ASR 回填与自动发问](./04-microphone-asr-question-flow.md)
5. [新问题打断、断线温和重连与不可用降级](./05-interrupt-reconnect-and-degradation.md)
6. [清理 `/guide` 旧数字人口播主链路并补本地运行文档](./06-remove-legacy-avatar-and-document-runbook.md)

以下拆分基于已确认的本地单机边界、`/guide` 单页替换范围、A5 问答真相源保留、OpenAvatarChat 复用与最小适配策略。

## Proposed Slices

1. **Title**: 建立 avatar service 本地骨架与联合启动基础  
   **Type**: AFK  
   **Blocked by**: None - can start immediately  
   **User stories covered**: 22, 25, 26, 27, 28, 36

2. **Title**: 打通 `/guide` 单会话初始化、健康检查与左侧状态层  
   **Type**: AFK  
   **Blocked by**: 1  
   **User stories covered**: 11, 13, 14, 16, 17, 21, 31

3. **Title**: 文字输入流式回答接入 LiteAvatar 自动播报  
   **Type**: AFK  
   **Blocked by**: 2  
   **User stories covered**: 1, 2, 3, 4, 5, 6, 20, 29, 32, 34

4. **Title**: 麦克风半双工录音、ASR 回填与自动发问  
   **Type**: AFK  
   **Blocked by**: 2  
   **User stories covered**: 7, 8, 9, 10, 20, 30, 34

5. **Title**: 新问题打断、断线温和重连与不可用降级  
   **Type**: AFK  
   **Blocked by**: 3, 4  
   **User stories covered**: 5, 15, 16, 17, 32, 35

6. **Title**: 清理 `/guide` 旧数字人口播主链路并补本地运行文档  
   **Type**: AFK  
   **Blocked by**: 3, 4, 5  
   **User stories covered**: 18, 19, 21, 28, 36

## Notes On Granularity

- 这组切片遵循 tracer-bullet 方式，优先保证每一项完成后都能形成可验证的演示增量。
- 我刻意没有拆成“只做前端”“只做后端”“只做脚本”这种水平切片。
- 第 3 和第 4 分开，是为了让“文字输入数字人口播”和“麦克风语音对话”可以分别落地与回归。
- 第 5 单独保留，是因为打断、重连、不可用降级是游客体验与演示稳定性的关键风险点。

## Review Questions

1. 这个粒度你觉得合适吗：偏粗、偏细，还是刚好？
2. 你希望“麦克风半双工录音”和“打断/重连/降级”合并成一个更大的切片吗？
3. 你希望“旧链路清理 + 文档”继续保持最后一个收尾切片，还是提前拆开？
