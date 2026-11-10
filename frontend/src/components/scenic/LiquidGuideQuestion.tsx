import { Link } from 'react-router-dom';

interface LiquidGuideQuestionProps {
  to: string;
  children: string;
}

/**
 * Adapted from "Liquid Button" by Thea / HighFlyer910
 * https://codepen.io/HighFlyer910/pen/gbgMQLL
 * MIT License — see liquid-button.zip supplied with this project.
 */
export default function LiquidGuideQuestion({ to, children }: LiquidGuideQuestionProps) {
  return (
    <Link className="liquid-guide-question" to={to}>
      <span className="liquid-guide-question__distortion" aria-hidden="true" />
      <span className="liquid-guide-question__base" aria-hidden="true" />
      <span className="liquid-guide-question__border" aria-hidden="true" />
      <span className="liquid-guide-question__content">{children}</span>
    </Link>
  );
}
