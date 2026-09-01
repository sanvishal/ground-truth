export const MASTER_VOLUME = 2.2;

export const applyMasterVolume = (volume: number): number =>
  Math.max(0, Math.min(1, volume * MASTER_VOLUME));
