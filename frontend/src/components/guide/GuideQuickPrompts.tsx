export interface GuideQuickPrompt {
  id: string;
  category: string;
  question: string;
}

interface GuideQuickPromptsProps {
  prompts: GuideQuickPrompt[];
  disabled?: boolean;
  onSelect: (question: string) => void;
}

export default function GuideQuickPrompts({
  prompts,
  disabled = false,
  onSelect,
}: GuideQuickPromptsProps) {
  return (
    <aside className="guide-quick-prompts" aria-label="推荐提问" data-testid="guide-quick-prompts">
      <svg className="guide-quick-prompts__filter" aria-hidden="true" focusable="false">
        <filter id="guide-glass-distortion" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.001 0.005" numOctaves="1" seed="17" result="turbulence" />
          <feComponentTransfer in="turbulence" result="mapped">
            <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
            <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
            <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
          </feComponentTransfer>
          <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
          <feSpecularLighting
            in="softMap"
            surfaceScale="5"
            specularConstant="1"
            specularExponent="100"
            lightingColor="white"
            result="specLight"
          >
            <fePointLight x="-200" y="-200" z="300" />
          </feSpecularLighting>
          <feComposite in="specLight" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litImage" />
          <feDisplacementMap in="SourceGraphic" in2="softMap" scale="200" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <div className="guide-quick-prompts__heading">
        <span>推荐提问</span>
      </div>

      <div className="guide-quick-prompts__list">
        {prompts.map((prompt) => (
          <button
            className="guide-glass-prompt"
            data-testid={`guide-prompt-${prompt.id}`}
            disabled={disabled}
            key={prompt.id}
            type="button"
            onClick={() => onSelect(prompt.question)}
          >
            <span className="guide-glass-prompt__distortion" aria-hidden="true" />
            <span className="guide-glass-prompt__base" aria-hidden="true" />
            <span className="guide-glass-prompt__border" aria-hidden="true" />
            <span className="guide-glass-prompt__content">
              <strong>{prompt.category}</strong>
              <span>{prompt.question}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
