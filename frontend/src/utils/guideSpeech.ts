const SENTENCE_PATTERN = /.*?(?:[。！？!?；;]+|\.(?=\s|$)|$)/g;
const SOFT_BREAKS = ['，', '、', '：', ',', ':'];

function splitLongSentence(sentence: string, maxLength: number) {
  const chunks: string[] = [];
  let remaining = sentence.trim();

  while (remaining.length > maxLength) {
    let breakAt = -1;
    for (const separator of SOFT_BREAKS) {
      const candidate = remaining.lastIndexOf(separator, maxLength);
      if (candidate >= Math.floor(maxLength * 0.48)) {
        breakAt = Math.max(breakAt, candidate + separator.length);
      }
    }

    if (breakAt < 0) breakAt = maxLength;
    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function splitGuideSpeech(text: string, maxLength = 46) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = Array.from(normalized.matchAll(SENTENCE_PATTERN))
    .map((match) => match[0].trim())
    .filter(Boolean);

  return sentences.flatMap((sentence) =>
    splitLongSentence(sentence, maxLength),
  );
}

export function sentenceReadingDelay(text: string) {
  return Math.min(5_200, Math.max(1_800, text.trim().length * 115));
}

function sentenceSpeechWeight(text: string) {
  const tokens = text.trim().match(/[A-Za-z0-9]+|./gu) ?? [];
  const weight = tokens.reduce((total, token) => {
    if (/^[A-Za-z0-9]+$/u.test(token)) {
      return total + Math.max(1, token.length * 0.45);
    }
    if (/[。！？!?]/u.test(token)) return total + 1.2;
    if (/[，、；;：:,]/u.test(token)) return total + 0.75;
    if (/[.…]/u.test(token)) return total + 0.6;
    if (/\s/u.test(token)) return total;
    return total + 1;
  }, 0);
  return Math.max(1, weight);
}

export function sentenceIndexAtAudioTime(
  sentences: string[],
  currentTime: number,
  duration: number,
) {
  if (!sentences.length) return -1;
  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }

  const weights = sentences.map(sentenceSpeechWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const progress = Math.min(1, Math.max(0, currentTime / duration));
  const progressWeight = totalWeight * progress;
  let cumulativeWeight = 0;

  for (let index = 0; index < weights.length; index += 1) {
    cumulativeWeight += weights[index];
    if (progressWeight < cumulativeWeight) return index;
  }

  return sentences.length - 1;
}
