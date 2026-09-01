export interface GlyphOffset {
  x: number;
  y: number;
}

export function jitterOffset(frame: number, glyphIndex: number, seed: number): GlyphOffset {
  const restrained = (value: number): number => {
    const phase = ((value % 5) + 5) % 5;
    if (phase === 0) return -1;
    if (phase === 4) return 1;
    return 0;
  };
  return {
    x: restrained(frame * 2 + glyphIndex + seed),
    y: restrained(frame + glyphIndex * 3 + seed * 2)
  };
}

export function isAutoJitterWord(value: string): boolean {
  const word = value.trim();
  return /^b+z{2,}t+/i.test(word)
    || /^th+u+d+/i.test(word)
    || /^c+l+a+c+k+/i.test(word)
    || /^metal/i.test(word)
    || /^cre+a+k+s+/i.test(word);
}

export function isAutoWaveWord(value: string): boolean {
  const word = value.trim();
  return /^u+h{3,}/i.test(word) || /^p+s{2,}h{2,}/i.test(word);
}
