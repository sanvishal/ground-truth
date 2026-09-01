export type Speaker = "KORE" | "DEMI";
export type ReactionSource = "hover" | "click" | "world";
export type DialogueOrigin = "system" | "transmit";

export interface PageMetrics {
  maxWidth: number;
  maxLines: number;
  measure: (text: string) => number;
}

export interface DialogueMessage {
  id: number;
  speaker: Speaker;
  origin: DialogueOrigin;
  body: string;
  pages: string[];
  pageIndex: number;
  visibleCharacters: number;
  typing: boolean;
  fullyRead: boolean;
  arrivedAt: number;
  transient?: boolean;
}

export interface ChannelState {
  speaker: Speaker;
  current: DialogueMessage | null;
  queue: DialogueMessage[];
  unread: boolean;
}

export interface DialogueSnapshot {
  activeSpeaker: Speaker;
  channels: Record<Speaker, ChannelState>;
  pendingKore: number;
  pendingDemi: number;
  revision: number;
}
