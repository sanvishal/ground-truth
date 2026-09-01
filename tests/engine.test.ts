import { describe, expect, it } from "vitest";
import { DialogueEngine } from "../src/dialogue/engine";

const makeEngine = () => new DialogueEngine({
  maxWidth: 32,
  maxLines: 2,
  measure: (value) => value.length
});

describe("DialogueEngine", () => {
  it("first click completes type-on and the next click advances the page", () => {
    const engine = makeEngine();
    engine.receiveKore("First page is deliberately complete. Second page is also deliberately complete.", 0);

    expect(engine.advance(1)).toBe("completed-page");
    expect(engine.snapshot().channels.KORE.current?.pageIndex).toBe(0);
    expect(engine.advance(2)).toBe("next-page");
    expect(engine.snapshot().channels.KORE.current?.pageIndex).toBe(1);
  });

  it("loops completed multi-page dialogue without replaying type-on", () => {
    const engine = makeEngine();
    engine.receiveKore("First page is deliberately complete. Second page is also deliberately complete.", 0);

    engine.advance(1);
    engine.advance(2);
    engine.advance(3);
    expect(engine.snapshot().channels.KORE.current?.fullyRead).toBe(true);

    expect(engine.advance(4)).toBe("looped-page");
    const firstPage = engine.snapshot().channels.KORE.current!;
    expect(firstPage.pageIndex).toBe(0);
    expect(firstPage.typing).toBe(false);
    expect(firstPage.visibleCharacters).toBe(firstPage.pages[0].length);

    expect(engine.advance(5)).toBe("looped-page");
    expect(engine.snapshot().channels.KORE.current?.pageIndex).toBe(1);
  });

  it("queues a KORE transmission while a multi-page Demi message is being read", () => {
    const engine = makeEngine();
    engine.echoDemi("First Demi page is complete.\n\nSecond Demi page is complete.", 0);
    engine.receiveKore("Held transmission.", 1);

    expect(engine.snapshot().activeSpeaker).toBe("DEMI");
    expect(engine.snapshot().pendingKore).toBe(1);

    engine.advance(2);
    engine.advance(3);
    engine.advance(4);
    engine.advance(5);
    expect(engine.snapshot().activeSpeaker).toBe("KORE");
  });

  it("queues a KORE transmission until a single-page Demi message is fully read", () => {
    const engine = makeEngine();
    engine.echoDemi("Single unfinished line.", 0);
    engine.receiveKore("Held transmission.", 1);

    expect(engine.snapshot().activeSpeaker).toBe("DEMI");
    expect(engine.snapshot().pendingKore).toBe(1);

    expect(engine.advance(2)).toBe("completed-page");
    expect(engine.snapshot().activeSpeaker).toBe("DEMI");
    expect(engine.advance(3)).toBe("next-message");
    expect(engine.snapshot().activeSpeaker).toBe("KORE");
  });

  it("automatically hands a relayed Demi echo to KORE after two seconds", () => {
    const engine = makeEngine();
    engine.echoDemi("Relayed player line.", 0, "transmit");
    engine.receiveKore("KORE response.", 1, "transmit");
    engine.advance(2);

    engine.tick(1999);
    expect(engine.snapshot().activeSpeaker).toBe("DEMI");
    engine.tick(2);
    expect(engine.snapshot().activeSpeaker).toBe("KORE");
  });

  it("keeps only the newest hover reaction and expires it after four seconds", () => {
    const engine = makeEngine();
    engine.receiveKore("A live transmission that has not finished.", 0);
    engine.reactDemi("Older hover.", "hover", 10);
    engine.reactDemi("Newer hover.", "hover", 20);
    engine.advance(5000);
    engine.advance(5001);

    expect(engine.snapshot().channels.DEMI.current).toBeNull();
  });

  it("portrait recall restores the other speaker without replaying type-on", () => {
    const engine = makeEngine();
    engine.receiveKore("Remember this line.", 0);
    engine.advance(1);
    engine.echoDemi("And remember this reply.", 2);
    engine.advance(3);

    expect(engine.clickPortrait("KORE")).toBe(true);
    const recalled = engine.snapshot().channels.KORE.current;
    expect(recalled?.typing).toBe(false);
    expect(recalled?.fullyRead).toBe(true);
  });

  it("slows and pauses elongated sounds only for system dialogue", () => {
    const system = makeEngine();
    const transmit = makeEngine();
    system.echoDemi("uhhhhh then", 0, "system");
    transmit.echoDemi("uhhhhh then", 0, "transmit");

    system.tick(260);
    transmit.tick(260);

    const systemMessage = system.snapshot().channels.DEMI.current;
    const transmitMessage = transmit.snapshot().channels.DEMI.current;
    expect(systemMessage?.visibleCharacters).toBeLessThan(transmitMessage?.visibleCharacters ?? 0);
    expect(systemMessage?.origin).toBe("system");
    expect(transmitMessage?.origin).toBe("transmit");
  });

  it("removes em dashes from authored dialogue while preserving exact player echoes", () => {
    const engine = makeEngine();
    engine.receiveKore("Wait — listen.", 0, "transmit");
    expect(engine.snapshot().channels.KORE.current?.body).toBe("Wait; listen.");

    engine.echoDemi("I — said it.", 1, "transmit");
    expect(engine.snapshot().channels.DEMI.current?.body).toBe("I — said it.");
  });
});
