import { Container, Sprite, Texture } from "pixi.js";
import type { Level1LightingStage } from "./level1-spec";
import { stepSparkParticle, type SparkParticleState } from "./spark-physics";

export interface SparkEmitterDefinition {
  x: number;
  y: number;
  floorY: number;
  direction: number;
  spread: number;
  burstMin: number;
  burstMax: number;
  intervalMin: number;
  intervalMax: number;
  speedMin: number;
  speedMax: number;
}

interface RuntimeEmitter extends SparkEmitterDefinition {
  nextBurst: number;
  flareLife: number;
  readonly flare: Container;
  burstLight: RuntimeBurstLight | null;
}

interface RuntimeSpark {
  readonly node: Container;
  readonly glow: Container;
  readonly state: SparkParticleState;
  active: boolean;
  floorY: number;
  maxLife: number;
  baseLength: number;
}

interface RuntimeBurstLight {
  readonly node: Sprite;
  age: number;
  triggered: boolean;
  holdLife: number;
  fadeLife: number;
  peakScale: number;
}

export interface Level1SparkSystem {
  readonly container: Container;
  update(deltaMs: number): void;
  setStage(stage: Level1LightingStage): void;
  destroy(): void;
}

const GRAVITY = 540;
const MAX_SPARKS = 72;
const PRELIGHT_LEAD_MS = 120;

const EMITTERS: readonly SparkEmitterDefinition[] = [
  // The visible loose ceiling cable at the upper-left.
  { x: 281, y: 43, floorY: 337, direction: 1.47, spread: 0.66, burstMin: 3, burstMax: 14, intervalMin: 3000, intervalMax: 6500, speedMin: 62, speedMax: 176 },
  // Damaged electrical face on the tall left cabinet; fragments fan rightward.
  { x: 112, y: 101, floorY: 337, direction: 0.08, spread: 0.5, burstMin: 3, burstMax: 12, intervalMin: 3600, intervalMax: 7600, speedMin: 112, speedMax: 224 },
  // Damaged center console: eject upward first, then let gravity return the arc to the deck.
  { x: 420, y: 238, floorY: 337, direction: -1.48, spread: 1.22, burstMin: 2, burstMax: 12, intervalMin: 3900, intervalMax: 8000, speedMin: 138, speedMax: 270 },
  // Right lip of the open floor hatch, throwing hot fragments upward-left.
  { x: 647, y: 319, floorY: 341, direction: -2.06, spread: 0.86, burstMin: 3, burstMax: 15, intervalMin: 3400, intervalMax: 7200, speedMin: 112, speedMax: 238 }
] as const;

const STAGE_ACTIVITY: Record<Level1LightingStage, number> = {
  1: 0.78,
  2: 1.08,
  3: 0.68,
  4: 0.14,
  5: 0.96
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function rectSprite(x: number, y: number, width: number, height: number, tint: number, alpha: number): Sprite {
  const sprite = new Sprite(Texture.WHITE);
  sprite.position.set(x, y);
  sprite.width = width;
  sprite.height = height;
  sprite.tint = tint;
  sprite.alpha = alpha;
  return sprite;
}

function makeSparkGraphic(): Container {
  const spark = new Container();
  spark.addChild(
    rectSprite(-2, -5, 4, 10, 0xff6d22, 0.16),
    rectSprite(-1, -4, 2, 8, 0xffa42e, 0.82),
    rectSprite(0, -3, 1, 6, 0xffe082, 1)
  );
  spark.blendMode = "add";
  spark.visible = false;
  return spark;
}

function makeSparkGlow(): Container {
  const glow = new Container();
  glow.addChild(
    rectSprite(-3, -6, 6, 12, 0xff7b22, 0.26),
    rectSprite(-2, -5, 4, 10, 0xffc044, 0.36)
  );
  glow.blendMode = "add";
  glow.visible = false;
  return glow;
}

function makeFlare(x: number, y: number): Container {
  const flare = new Container();
  flare.addChild(
    rectSprite(-7, -1, 14, 2, 0xff8a24, 0.2),
    rectSprite(-1, -7, 2, 14, 0xff8a24, 0.2),
    rectSprite(-4, -1, 8, 2, 0xffe080, 0.68),
    rectSprite(-1, -4, 2, 8, 0xffe080, 0.68),
    rectSprite(-1, -1, 3, 3, 0xfff1bc, 0.82)
  );
  flare.position.set(x, y);
  flare.blendMode = "add";
  flare.visible = false;
  return flare;
}

function makeBurstGlowTexture(): Texture {
  const size = 72;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return Texture.WHITE;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 246, 190, 0.22)");
  gradient.addColorStop(0.2, "rgba(255, 167, 58, 0.1)");
  gradient.addColorStop(1, "rgba(255, 112, 24, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export function createLevel1SparkSystem(
  onBurst?: () => void,
  emitterDefinitions: readonly SparkEmitterDefinition[] = EMITTERS
): Level1SparkSystem {
  const container = new Container();
  const burstLightLayer = new Container();
  const glowLayer = new Container();
  const flareLayer = new Container();
  const particleLayer = new Container();
  container.addChild(burstLightLayer, glowLayer, flareLayer, particleLayer);
  const burstGlowTexture = makeBurstGlowTexture();

  const random = seededRandom(0x53504152);
  const emitters: RuntimeEmitter[] = emitterDefinitions.map((definition, index) => {
    const flare = makeFlare(definition.x, definition.y);
    flareLayer.addChild(flare);
    return {
      ...definition,
      // Stagger the opening bursts so the room never fires every source at once.
      nextBurst: 700 + index * 920 + random() * 1400,
      flareLife: 0,
      flare,
      burstLight: null
    };
  });
  const particles: RuntimeSpark[] = Array.from({ length: MAX_SPARKS }, () => {
    const node = makeSparkGraphic();
    const glow = makeSparkGlow();
    particleLayer.addChild(node);
    glowLayer.addChild(glow);
    return {
      node,
      glow,
      state: { x: 0, y: 0, vx: 0, vy: 0, life: 0, bounces: 0 },
      active: false,
      floorY: 0,
      maxLife: 1,
      baseLength: 1
    };
  });
  const burstLights: RuntimeBurstLight[] = [];

  let stage: Level1LightingStage = 1;

  const createBurstLight = (emitter: RuntimeEmitter): RuntimeBurstLight => {
    const node = new Sprite(burstGlowTexture);
    node.anchor.set(0.5);
    node.width = 72;
    node.height = 72;
    node.position.set(emitter.x, emitter.y);
    node.blendMode = "add";
    node.alpha = 0;
    node.scale.set(0.55);
    burstLightLayer.addChild(node);
    const light: RuntimeBurstLight = {
      node,
      age: 0,
      triggered: false,
      holdLife: 0.18,
      fadeLife: 0.32,
      peakScale: 1
    };
    burstLights.push(light);
    emitter.burstLight = light;
    return light;
  };

  const spawnSpark = (emitter: RuntimeEmitter, fragment = false) => {
    const particle = particles.find((candidate) => !candidate.active);
    if (!particle) return;
    const angle = emitter.direction + (random() - 0.5) * emitter.spread;
    const authoredSpeed = emitter.speedMin + random() * (emitter.speedMax - emitter.speedMin);
    const speed = fragment ? authoredSpeed * (0.48 + random() * 0.22) : authoredSpeed;
    const life = fragment ? 0.32 + random() * 0.22 : 0.72 + random() * 0.58;
    Object.assign(particle.state, {
      x: emitter.x + (random() - 0.5) * 5,
      y: emitter.y + (random() - 0.5) * 3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      bounces: 0
    });
    particle.floorY = emitter.floorY + (random() - 0.5) * 5;
    particle.maxLife = life;
    particle.baseLength = fragment ? 0.45 : 0.7 + random() * 0.85;
    particle.active = true;
    particle.node.visible = true;
    particle.glow.visible = true;
    particle.node.alpha = 1;
    particle.glow.alpha = 0.62;
  };

  const burst = (emitter: RuntimeEmitter) => {
    const activity = STAGE_ACTIVITY[stage];
    // Bias toward small spits, while retaining occasional larger showers.
    const countRoll = Math.pow(random(), 1.65);
    const baseCount = emitter.burstMin + Math.floor(countRoll * (emitter.burstMax - emitter.burstMin + 1));
    const stageCountScale = stage === 2 ? 1.15 : stage === 4 ? 0.55 : 1;
    const count = Math.max(1, Math.round(baseCount * stageCountScale));
    onBurst?.();
    for (let index = 0; index < count; index += 1) spawnSpark(emitter, index >= Math.ceil(count * 0.72));
    emitter.flareLife = 0.11;
    emitter.flare.visible = true;
    emitter.flare.alpha = 1;
    emitter.flare.scale.set(0.75);

    // The local response begins as a small pre-glow, holds through the burst,
    // then fades. It is still destroyed as soon as the afterglow completes.
    const light = emitter.burstLight ?? createBurstLight(emitter);
    light.triggered = true;
    light.age = 0;
    light.holdLife = 0.18 + Math.min(count, 10) * 0.004;
    light.fadeLife = 0.32;
    light.peakScale = 1 + Math.min(count, 12) * 0.015;
    light.node.alpha = 1;
    emitter.burstLight = null;
  };

  return {
    container,
    setStage(nextStage) {
      stage = nextStage;
    },
    update(deltaMs) {
      const deltaSeconds = Math.min(deltaMs / 1000, 0.05);
      const activity = STAGE_ACTIVITY[stage];

      for (const emitter of emitters) {
        emitter.nextBurst -= deltaMs * activity;
        if (emitter.nextBurst <= PRELIGHT_LEAD_MS && !emitter.burstLight) {
          createBurstLight(emitter);
        }
        if (emitter.nextBurst <= 0) {
          burst(emitter);
          emitter.nextBurst = emitter.intervalMin + random() * (emitter.intervalMax - emitter.intervalMin);
        }
        if (emitter.flareLife > 0) {
          emitter.flareLife -= deltaSeconds;
          const remaining = Math.max(0, emitter.flareLife / 0.11);
          emitter.flare.alpha = remaining;
          emitter.flare.scale.set(0.75 + (1 - remaining) * 0.65);
          if (emitter.flareLife <= 0) emitter.flare.visible = false;
        }
      }

      for (const particle of particles) {
        if (!particle.active) continue;
        const result = stepSparkParticle(particle.state, deltaSeconds, GRAVITY, particle.floorY);
        if (result.expired || particle.state.x < -12 || particle.state.x > 972) {
          particle.active = false;
          particle.node.visible = false;
          particle.glow.visible = false;
          continue;
        }
        const speed = Math.hypot(particle.state.vx, particle.state.vy);
        const lifeAlpha = Math.min(1, particle.state.life / Math.max(0.001, particle.maxLife) * 1.8);
        particle.node.position.set(Math.round(particle.state.x), Math.round(particle.state.y));
        particle.node.rotation = Math.atan2(particle.state.vy, particle.state.vx) + Math.PI / 2;
        particle.node.scale.set(
          particle.state.bounces > 0 ? 0.68 : 1,
          particle.baseLength * Math.max(0.45, Math.min(1.85, speed / 118)) * (particle.state.bounces > 0 ? 0.5 : 1)
        );
        particle.node.alpha = lifeAlpha;
        particle.glow.position.copyFrom(particle.node.position);
        particle.glow.rotation = particle.node.rotation;
        particle.glow.scale.copyFrom(particle.node.scale);
        particle.glow.alpha = lifeAlpha * 0.58;
      }


      for (let index = burstLights.length - 1; index >= 0; index -= 1) {
        const light = burstLights[index];
        light.age += deltaSeconds;
        if (!light.triggered) {
          const prelightProgress = Math.min(1, light.age / (PRELIGHT_LEAD_MS / 1000));
          light.node.alpha = 0.18 + prelightProgress * 0.34;
          light.node.scale.set(0.55 + prelightProgress * 0.2);
          continue;
        }
        const fadeAge = light.age - light.holdLife;
        if (fadeAge >= light.fadeLife) {
          burstLightLayer.removeChild(light.node);
          light.node.destroy();
          burstLights.splice(index, 1);
          continue;
        }
        if (fadeAge <= 0) {
          light.node.alpha = 1;
          light.node.scale.set(light.peakScale);
          continue;
        }
        const remaining = 1 - fadeAge / light.fadeLife;
        light.node.alpha = Math.pow(remaining, 1.35);
        light.node.scale.set(light.peakScale + (1 - remaining) * 0.34);
      }
    },
    destroy() {
      for (const light of burstLights) {
        light.node.destroy();
      }
      burstLights.length = 0;
    }
  };
}
