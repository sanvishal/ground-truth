import { describe, expect, it } from "vitest";
import { segmentMessage } from "../src/dialogue/segment";
import { KORE_OPENING_PAGES, KORE_OPENING_RESPONSE } from "../src/content/level1";

const metrics = {
  maxWidth: 28,
  maxLines: 2,
  measure: (value: string) => value.length
};

describe("segmentMessage", () => {
  it("honors author-supplied blank-line page breaks", () => {
    expect(segmentMessage("First instruction.\n\nSecond instruction.", metrics)).toEqual([
      "First instruction.",
      "Second instruction."
    ]);
  });

  it("only splits automatic pages on sentence boundaries", () => {
    const pages = segmentMessage(
      "The primary loop is unstable. Keep your hands off the red breaker. Read the damaged label back to me.",
      metrics
    );

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => /[.!?]$/.test(page))).toBe(true);
    expect(pages.join(" ")).toContain("Read the damaged label back to me.");
  });

  it("returns no pages for an empty transmission", () => {
    expect(segmentMessage("   ", metrics)).toEqual([]);
  });

  it("preserves the authored pause before KORE reports the dead crew", () => {
    const roomyMetrics = { maxWidth: 1000, maxLines: 8, measure: (value: string) => value.length };
    expect(segmentMessage(KORE_OPENING_RESPONSE, roomyMetrics)).toEqual([...KORE_OPENING_PAGES]);
  });
});
