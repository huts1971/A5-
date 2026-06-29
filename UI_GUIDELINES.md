# UI Guidelines

## Product Direction

The UI should feel like a practical scenic-area AI guide product, not a generic
admin demo or marketing landing page.

- Visitor side: warm, polished, scenic, and guide-oriented.
- Admin side: dense, predictable, operational, and efficient.
- Digital human side: friendly guide presence with stable audio and source-aware
  answers.

## Required Stack

- React 18
- Vite 6
- TypeScript
- Ant Design 5
- Ant Design Icons
- Existing CSS in `frontend/src/styles/global.css`
- Existing LiteAvatar stage and scenic photo assets

Do not introduce Vue, a second UI framework, Tailwind, or a separate design
system without explicit approval.

## Visitor Experience

Visitor pages should prioritize the core demo loop:

1. Understand the product from the home page.
2. Browse scenic spots.
3. Choose a route preference.
4. Ask the AI guide.
5. See grounded sources.
6. Hear or stop an answer cleanly.

Rules:

- Use real scenic photos where available.
- Keep spot cards image-led, with concise tags and visit-time metadata.
- Route cards must show why a route is recommended.
- AI answer cards must show sources when available.
- Long Chinese text must wrap cleanly without horizontal scrolling.
- Loading, empty, error, and retry states are required for data-driven views.

## Admin Experience

Admin screens are operational tools, not promotional pages.

- Prefer tables, filters, compact forms, and clear action buttons.
- Keep destructive actions explicit and recoverable where possible.
- Show knowledge and chat-log status in plain language.
- Keep source/provenance information visible for web-fact review.
- Do not hide important operational data behind decorative layouts.

## Digital Human And Audio

- Preserve the current LiteAvatar direction.
- Keep ready, listening, thinking, speaking, preparing, and disconnected states
  meaningful without duplicating status text in the chat panel.
- A new question must interrupt the previous Avatar speech.
- If Avatar/TTS is unavailable, keep text chat available and degrade gracefully.
- Do not implement 3D modeling, motion capture, or real-time lip sync unless the
  team explicitly accepts that scope.

## Visual Consistency

- Use Ant Design controls before custom controls.
- Use icons in buttons where available.
- Keep cards, forms, buttons, and source cards visually consistent across pages.
- Do not add decorative visual systems that compete with scenic photos or
  LiteAvatar.
- Avoid large unrelated gradients, oversized marketing hero sections, and
  one-off page-specific UI patterns.

## Accessibility And Layout

- Buttons and links must have clear labels.
- Forms need validation feedback.
- Mobile layouts must not overlap, clip text, or require horizontal scrolling.
- Fixed-format UI such as cards, route lists, and audio controls should have
  stable dimensions where feasible.
- The main demo should run repeatedly without white screens or broken layouts.
