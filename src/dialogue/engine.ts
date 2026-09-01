import { segmentMessage } from "./segment";
import type { ChannelState, DialogueMessage, DialogueOrigin, DialogueSnapshot, PageMetrics, ReactionSource, Speaker } from "./types";

type Listener = (snapshot: DialogueSnapshot) => void;
type CharacterListener = (speaker: Speaker, character: string, index: number) => void;

interface PendingReaction {
  body: string;
  source: ReactionSource;
  createdAt: number;
  autoAdvance: boolean;
}

const cloneChannel = (channel: ChannelState): ChannelState => ({
  ...channel,
  current: channel.current ? { ...channel.current, pages: [...channel.current.pages] } : null,
  queue: channel.queue.map((message) => ({ ...message, pages: [...message.pages] }))
});

export class DialogueEngine {
  private metrics: PageMetrics;
  private cps = 40;
  private serial = 0;
  private revision = 0;
  private accumulator = 0;
  private listeners = new Set<Listener>();
  private characterListeners = new Set<CharacterListener>();
  private pendingKore: DialogueMessage[] = [];
  private pendingReactions: PendingReaction[] = [];
  private autoAdvanceDemiMessageId: number | null = null;
  private autoAdvanceDemiRemainingMs = 0;
  private transientDemiActive = false;
  private transientDemiReturn: DialogueMessage | null = null;
  private channels: Record<Speaker, ChannelState> = {
    KORE: { speaker: "KORE", current: null, queue: [], unread: false },
    DEMI: { speaker: "DEMI", current: null, queue: [], unread: false }
  };

  activeSpeaker: Speaker = "KORE";

  constructor(metrics: PageMetrics) {
    this.metrics = metrics;
  }

  setCharactersPerSecond(value: number): void {
    this.cps = Math.max(5, Math.min(120, value));
  }

  pageCount(body: string): number {
    return segmentMessage(body, this.metrics).length;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  onCharacter(listener: CharacterListener): () => void {
    this.characterListeners.add(listener);
    return () => this.characterListeners.delete(listener);
  }

  snapshot(): DialogueSnapshot {
    return {
      activeSpeaker: this.activeSpeaker,
      channels: { KORE: cloneChannel(this.channels.KORE), DEMI: cloneChannel(this.channels.DEMI) },
      pendingKore: this.pendingKore.length,
      pendingDemi: this.pendingReactions.length,
      revision: this.revision
    };
  }

  private emit(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private makeMessage(speaker: Speaker, body: string, now: number, origin: DialogueOrigin): DialogueMessage | null {
    const authored = origin === "system" || speaker === "KORE";
    const normalizedBody = authored ? body.replace(/\s*—\s*/g, "; ") : body;
    const pages = segmentMessage(normalizedBody, this.metrics);
    if (!pages.length) return null;
    return {
      id: ++this.serial,
      speaker,
      origin,
      body: normalizedBody,
      pages,
      pageIndex: 0,
      visibleCharacters: 0,
      typing: true,
      fullyRead: false,
      arrivedAt: now
    };
  }

  private isUnread(speaker: Speaker): boolean {
    const message = this.channels[speaker].current;
    return Boolean(message && !message.fullyRead);
  }

  private activate(message: DialogueMessage): void {
    if (message.id !== this.autoAdvanceDemiMessageId) {
      this.autoAdvanceDemiMessageId = null;
      this.autoAdvanceDemiRemainingMs = 0;
    }
    this.activeSpeaker = message.speaker;
    this.channels[message.speaker].current = message;
    this.channels[message.speaker].unread = true;
    this.accumulator = 0;
    this.emit();
  }

  receiveKore(body: string, now = performance.now(), origin: DialogueOrigin = "system"): boolean {
    const message = this.makeMessage("KORE", body, now, origin);
    if (!message) return false;
    const currentKore = this.channels.KORE.current;
    if (this.activeSpeaker === "KORE" && currentKore && !currentKore.fullyRead) {
      this.channels.KORE.queue.push(message);
      this.channels.KORE.unread = true;
      this.emit();
      return true;
    }
    if (this.activeSpeaker === "DEMI" && this.isUnread("DEMI")) {
      this.pendingKore.push(message);
      this.channels.KORE.unread = true;
      this.emit();
      return true;
    }
    this.activate(message);
    return true;
  }

  echoDemi(body: string, now = performance.now(), origin: DialogueOrigin = "system", transient = false): boolean {
    if (!transient && this.transientDemiActive) this.restoreTransientDemi();
    const message = this.makeMessage("DEMI", body, now, origin);
    if (!message) return false;
    message.transient = transient;
    if (origin === "transmit") {
      this.autoAdvanceDemiMessageId = message.id;
      this.autoAdvanceDemiRemainingMs = -1;
    }
    this.activate(message);
    return true;
  }

  private restoreTransientDemi(): DialogueMessage | null {
    const restored = this.transientDemiReturn;
    this.channels.DEMI.current = restored;
    this.channels.DEMI.unread = Boolean(restored && !restored.fullyRead);
    this.transientDemiReturn = null;
    this.transientDemiActive = false;
    return restored;
  }

  private activateReaction(reaction: PendingReaction, now: number): void {
    if (reaction.source === "hover") {
      if (!this.transientDemiActive) {
        const current = this.channels.DEMI.current;
        this.transientDemiReturn = current ? { ...current, pages: [...current.pages] } : null;
        this.transientDemiActive = true;
      }
      this.echoDemi(reaction.body, now, "system", true);
      this.autoAdvanceDemiMessageId = this.channels.DEMI.current?.id ?? null;
      this.autoAdvanceDemiRemainingMs = -1;
      return;
    }
    this.echoDemi(reaction.body, now);
    if (reaction.autoAdvance) {
      this.autoAdvanceDemiMessageId = this.channels.DEMI.current?.id ?? null;
      this.autoAdvanceDemiRemainingMs = -1;
    }
  }

  restoreMessage(speaker: Speaker, body: string, pageIndex = 0, now = performance.now(), origin: DialogueOrigin = "system"): boolean {
    const message = this.makeMessage(speaker, body, now, origin);
    if (!message) return false;
    const restoredPage = Math.max(0, Math.min(message.pages.length - 1, pageIndex));
    message.pageIndex = restoredPage;
    message.visibleCharacters = message.pages[restoredPage]?.length ?? 0;
    message.typing = false;
    message.fullyRead = restoredPage === message.pages.length - 1;
    this.activeSpeaker = speaker;
    this.channels[speaker].current = message;
    this.channels[speaker].unread = false;
    this.accumulator = 0;
    this.emit();
    return true;
  }

  reactDemi(body: string, source: ReactionSource, now = performance.now(), autoAdvance = false): void {
    const kore = this.channels.KORE.current;
    const koreBusy = this.activeSpeaker === "KORE" && Boolean(kore && !kore.fullyRead);
    // Physical actions are immediate interruptions. Hover reactions remain
    // deferable so moving the pointer cannot constantly steal the dialogue.
    if (!koreBusy || source !== "hover") {
      this.activateReaction({ body, source, createdAt: now, autoAdvance }, now);
      return;
    }
    if (source === "hover") {
      this.pendingReactions = this.pendingReactions.filter((reaction) => reaction.source !== "hover");
    }
    this.pendingReactions.push({ body, source, createdAt: now, autoAdvance });
    this.emit();
  }

  private startNextPage(message: DialogueMessage): void {
    message.pageIndex += 1;
    message.visibleCharacters = 0;
    message.typing = true;
    this.accumulator = 0;
  }

  private showReadPage(message: DialogueMessage, pageIndex: number): void {
    message.pageIndex = pageIndex;
    message.visibleCharacters = message.pages[pageIndex]?.length ?? 0;
    message.typing = false;
    this.accumulator = 0;
  }

  private completePage(message: DialogueMessage): void {
    const page = message.pages[message.pageIndex] ?? "";
    message.visibleCharacters = page.length;
    message.typing = false;
    if (message.pageIndex === message.pages.length - 1) {
      message.fullyRead = true;
      this.channels[message.speaker].unread = false;
    }
  }

  private activateAfterComplete(now: number, allowSpeakerChange = true): boolean {
    const queue = this.channels[this.activeSpeaker].queue;
    if (queue.length) {
      this.activate(queue.shift()!);
      return true;
    }
    if (!allowSpeakerChange) return false;
    if (this.pendingKore.length) {
      this.activate(this.pendingKore.shift()!);
      return true;
    }
    this.pendingReactions = this.pendingReactions.filter((reaction) => reaction.source !== "hover" || now - reaction.createdAt <= 4000);
    if (this.pendingReactions.length) {
      const reaction = this.pendingReactions.shift()!;
      this.activateReaction(reaction, now);
      return true;
    }
    return false;
  }

  advance(now = performance.now()): "completed-page" | "next-page" | "looped-page" | "next-message" | "noop" {
    const message = this.channels[this.activeSpeaker].current;
    if (!message) return "noop";
    if (message.typing) {
      this.completePage(message);
      this.emit();
      return "completed-page";
    }
    if (message.fullyRead) {
      if (message.transient && this.transientDemiActive) {
        const restored = this.restoreTransientDemi();
        if (this.pendingKore.length) this.activate(this.pendingKore.shift()!);
        else {
          this.activeSpeaker = restored ? "DEMI" : "KORE";
          this.emit();
        }
        return "next-message";
      }
      if (this.activateAfterComplete(now, false)) return "next-message";
      if (message.pages.length > 1) {
        this.showReadPage(message, (message.pageIndex + 1) % message.pages.length);
        this.emit();
        return "looped-page";
      }
      return "noop";
    }
    if (message.pageIndex < message.pages.length - 1) {
      this.startNextPage(message);
      this.emit();
      return "next-page";
    }
    return this.activateAfterComplete(now, false) ? "next-message" : "noop";
  }

  clickPortrait(speaker: Speaker): boolean {
    if (this.transientDemiActive) this.restoreTransientDemi();
    if (speaker === this.activeSpeaker || !this.channels[speaker].current) return false;
    this.activeSpeaker = speaker;
    const message = this.channels[speaker].current!;
    this.completePage(message);
    this.emit();
    return true;
  }

  tick(deltaMs: number): void {
    const message = this.channels[this.activeSpeaker].current;
    if (!message) return;
    if (!message.typing) {
      this.tickAutoAdvanceDemi(message, deltaMs);
      return;
    }
    const page = message.pages[message.pageIndex] ?? "";
    this.accumulator += deltaMs;
    let changed = false;
    while (message.visibleCharacters < page.length) {
      const index = message.visibleCharacters;
      const current = page[index] ?? "";
      const previous = page[Math.max(0, message.visibleCharacters - 1)] ?? "";
      const system = message.origin === "system";
      const beforeCurrent = page.slice(0, index);
      const currentTokenStart = Math.max(beforeCurrent.lastIndexOf(" ") + 1, 0);
      const currentTokenEndOffset = page.slice(index).search(/\s/);
      const currentTokenEnd = currentTokenEndOffset < 0 ? page.length : index + currentTokenEndOffset;
      const currentToken = page.slice(currentTokenStart, currentTokenEnd);
      const precedingToken = beforeCurrent.trimEnd().split(/\s+/).at(-1) ?? "";
      const elongatedCurrent = system && /^u+h{3,}/i.test(currentToken);
      const pauseAfterElongated = system && /\s/.test(current) && /^u+h{3,}/i.test(precedingToken);
      const punctuation = previous === "…"
        ? (system ? 360 : 240)
        : /[.!?]/.test(previous)
          ? (system ? 220 : 140)
          : /[,;]/.test(previous)
            ? (system ? 90 : 60)
            : 0;
      const baseDelay = elongatedCurrent ? Math.max(68, 1000 / this.cps) : 1000 / this.cps;
      const delay = baseDelay + punctuation + (pauseAfterElongated ? 420 : 0);
      if (this.accumulator < delay) break;
      this.accumulator -= delay;
      const character = page[message.visibleCharacters];
      message.visibleCharacters += 1;
      changed = true;
      for (const listener of this.characterListeners) listener(message.speaker, character, message.visibleCharacters - 1);
    }
    if (message.visibleCharacters >= page.length) this.completePage(message);
    if (changed) this.emit();
    this.tickAutoAdvanceDemi(message, deltaMs);
  }

  private tickAutoAdvanceDemi(message: DialogueMessage, deltaMs: number): void {
    if (message.id !== this.autoAdvanceDemiMessageId || message.speaker !== "DEMI" || message.typing) return;
    if (this.autoAdvanceDemiRemainingMs < 0) {
      this.autoAdvanceDemiRemainingMs = 2000;
    }
    this.autoAdvanceDemiRemainingMs -= deltaMs;
    if (this.autoAdvanceDemiRemainingMs > 0) return;
    this.autoAdvanceDemiMessageId = null;
    this.autoAdvanceDemiRemainingMs = 0;
    if (message.transient && this.transientDemiActive) {
      const restored = this.restoreTransientDemi();
      if (this.pendingKore.length) this.activate(this.pendingKore.shift()!);
      else {
        this.activeSpeaker = restored ? "DEMI" : "KORE";
        this.emit();
      }
      return;
    }
    this.activateAfterComplete(performance.now());
  }
}
