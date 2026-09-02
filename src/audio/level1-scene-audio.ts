import { applyMasterVolume } from "./mix";

const AUDIO_ROOT = "/assets/audio/level1";

const SPARK_VARIANTS = ["spark-01.mp3", "spark-02.mp3", "spark-03.mp3"] as const;
const STEAM_VARIANTS = ["steam-01.mp3", "steam-02.mp3", "steam-03.mp3", "steam-04.mp3"] as const;

const makeAudio = (file: string, volume: number, loop = false): HTMLAudioElement => {
  const audio = new Audio(`${AUDIO_ROOT}/${file}`);
  audio.preload = loop ? "auto" : "metadata";
  audio.volume = applyMasterVolume(volume);
  audio.loop = loop;
  return audio;
};

export class Level1SceneAudio {
  private readonly ambient = makeAudio("ambient-space.mp3", 0.24, true);
  private readonly alarm = makeAudio("alarm-loop.mp3", 0.10, true);
  private readonly sparks = SPARK_VARIANTS.map((file) => makeAudio(file, 0.27));
  private readonly steam = STEAM_VARIANTS.map((file) => makeAudio(file, 0.22));
  private readonly panelOpen = makeAudio("panel-open.mp3", 0.24);
  private readonly panelClose = makeAudio("panel-close.mp3", 0.24);
  private readonly panelError = makeAudio("panel-error.mp3", 0.30);
  private readonly controlClunk = makeAudio("panel-close.mp3", 0.11);
  private unlocked = false;
  private menuActive = false;
  private sceneActive = false;
  private coldOpenActive = false;
  private alarmActive = false;
  private coldOpenAlarmActive = false;
  private visible = !document.hidden;
  private lastSparkAt = -Infinity;
  private lastSteamAt = -Infinity;
  private sparkCursor = Math.floor(Math.random() * this.sparks.length);
  private steamCursor = Math.floor(Math.random() * this.steam.length);
  private ignitionHumRate: number | null = null;
  private ignitionHumContext: AudioContext | null = null;
  private ignitionHumOscillator: OscillatorNode | null = null;
  private ignitionHumGain: GainNode | null = null;
  muted = false;

  private readonly onVisibilityChange = () => {
    this.visible = !document.hidden;
    this.syncLoops();
  };

  constructor() {
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.syncLoops();
  }

  setMuted(value: boolean): boolean {
    this.muted = value;
    this.syncLoops();
    return this.muted;
  }

  setSceneActive(active: boolean): void {
    this.sceneActive = active;
    this.syncLoops();
  }

  setMenuActive(active: boolean): void {
    this.menuActive = active;
    this.syncLoops();
  }

  setColdOpenActive(active: boolean): void {
    this.coldOpenActive = active;
    this.syncLoops();
  }

  setColdOpenAlarmActive(active: boolean): void {
    this.coldOpenAlarmActive = active;
    this.syncLoops();
  }

  setAlarmActive(active: boolean): void {
    this.alarmActive = active;
    this.syncLoops();
  }

  rareSpark(): void {
    const now = performance.now();
    if (!this.canPlay() || now - this.lastSparkAt < 6000 || Math.random() > 0.18) return;
    this.lastSparkAt = now;
    const audio = this.sparks[this.sparkCursor++ % this.sparks.length];
    this.playOneShot(audio);
  }

  rareSteam(): void {
    const now = performance.now();
    if (!this.canPlay() || now - this.lastSteamAt < 9000 || Math.random() > 0.22) return;
    this.lastSteamAt = now;
    const audio = this.steam[this.steamCursor++ % this.steam.length];
    this.playOneShot(audio);
  }

  playPanelOpen(): void {
    if (this.canPlay()) this.playOneShot(this.panelOpen);
  }

  playPanelClose(): void {
    if (this.canPlay()) this.playOneShot(this.panelClose);
  }

  playPanelError(): void {
    if (this.canPlay()) this.playOneShot(this.panelError);
  }

  playControlClunk(): void {
    if (this.canPlay()) this.playOneShot(this.controlClunk);
  }

  setIgnitionHumRate(rateIndex: number | null): void {
    this.ignitionHumRate = rateIndex;
    this.syncIgnitionHum();
  }

  private canPlay(): boolean {
    return this.unlocked && this.sceneActive && this.visible && !this.muted;
  }

  private playOneShot(audio: HTMLAudioElement): void {
    try {
      audio.pause();
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    } catch {
      // Media can still be loading during the first visual burst.
    }
  }

  private syncLoops(): void {
    const shouldPlayAmbient = this.unlocked
      && (this.menuActive || this.sceneActive || this.coldOpenActive)
      && this.visible
      && !this.muted;
    const shouldPlayAlarm = this.unlocked
      && ((this.sceneActive && this.alarmActive) || (this.coldOpenActive && this.coldOpenAlarmActive))
      && this.visible
      && !this.muted;
    this.ambient.muted = this.muted;
    this.alarm.muted = this.muted;
    this.panelOpen.muted = this.muted;
    this.panelClose.muted = this.muted;
    this.panelError.muted = this.muted;
    this.controlClunk.muted = this.muted;
    if (shouldPlayAmbient) void this.ambient.play().catch(() => {});
    else this.ambient.pause();
    if (shouldPlayAlarm) void this.alarm.play().catch(() => {});
    else {
      this.alarm.pause();
      this.alarm.currentTime = 0;
    }
    this.syncIgnitionHum();
  }

  private syncIgnitionHum(): void {
    const active = this.canPlay() && this.ignitionHumRate !== null;
    if (active && !this.ignitionHumContext) {
      const AudioContextClass = window.AudioContext;
      this.ignitionHumContext = new AudioContextClass();
      this.ignitionHumOscillator = this.ignitionHumContext.createOscillator();
      this.ignitionHumGain = this.ignitionHumContext.createGain();
      this.ignitionHumGain.gain.setValueAtTime(0, this.ignitionHumContext.currentTime);
      this.ignitionHumOscillator.type = "sawtooth";
      this.ignitionHumOscillator.connect(this.ignitionHumGain);
      this.ignitionHumGain.connect(this.ignitionHumContext.destination);
      this.ignitionHumOscillator.start();
    }
    if (!this.ignitionHumContext || !this.ignitionHumOscillator || !this.ignitionHumGain) return;
    const now = this.ignitionHumContext.currentTime;
    const rate = this.ignitionHumRate ?? 0;
    this.ignitionHumOscillator.frequency.setTargetAtTime(42 + rate * 13, now, 0.08);
    this.ignitionHumGain.gain.setTargetAtTime(active ? applyMasterVolume(0.012 + rate * 0.004) : 0, now, 0.08);
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    for (const audio of [this.ambient, this.alarm, this.panelOpen, this.panelClose, this.panelError, this.controlClunk, ...this.sparks, ...this.steam]) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    this.ignitionHumOscillator?.stop();
    void this.ignitionHumContext?.close();
  }
}
