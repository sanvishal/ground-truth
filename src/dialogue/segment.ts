import type { PageMetrics } from "./types";

export function wrappedLineCount(text: string, metrics: PageMetrics): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let lines = 1;
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && metrics.measure(candidate) > metrics.maxWidth) {
      lines += 1;
      line = word;
    } else {
      line = candidate;
    }
  }
  return lines;
}

function fits(text: string, metrics: PageMetrics): boolean {
  return wrappedLineCount(text, metrics) <= metrics.maxLines;
}

function sentences(text: string): string[] {
  return text
    .match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [text.trim()];
}

function paginateParagraph(paragraph: string, metrics: PageMetrics): string[] {
  const clean = paragraph.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (fits(clean, metrics)) return [clean];

  const units = sentences(clean);
  const pages: string[] = [];
  let page = "";
  for (const unit of units) {
    const candidate = page ? `${page} ${unit}` : unit;
    if (page && !fits(candidate, metrics)) {
      pages.push(page);
      page = unit;
    } else {
      page = candidate;
    }
  }
  if (page) pages.push(page);

  if (pages.length > 1) {
    const last = pages.at(-1)!;
    const previous = pages.at(-2)!;
    if (metrics.measure(last) < metrics.maxWidth && fits(`${previous} ${last}`, metrics)) {
      pages.splice(-2, 2, `${previous} ${last}`);
    }
  }
  return pages;
}

export function segmentMessage(body: string, metrics: PageMetrics): string[] {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const forcedSegments = normalized.split(/\n\s*\n+/);
  return forcedSegments.flatMap((segment) => paginateParagraph(segment, metrics));
}
