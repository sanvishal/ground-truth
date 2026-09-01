import { Container, Graphics } from "pixi.js";
import type { Level1LightingStage } from "./level1-spec";

interface SteamParticle {
  readonly node: Graphics;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  initialSpeed: number;
  falloff: number;
  baseScale: number;
  phase: number;
  lateralBias: number;
}

export interface SteamEmitterDefinition {
  x: number;
  y: number;
  direction: number;
  spread: number;
  speedMin: number;
  speedMax: number;
  lifeMin: number;
  lifeMax: number;
  cadenceMin: number;
  cadenceMax: number;
  initialDelayMin?: number;
  initialDelayMax?: number;
}

interface RuntimeSteamEmitter extends SteamEmitterDefinition {
  spawnTimer: number;
  firing: boolean;
  phaseTimer: number;
  directionOffset: number;
  falloff: number;
}

export interface Level1SteamSystem {
  readonly container: Container;
  update(deltaMs: number): void;
  setStage(stage: Level1LightingStage): void;
  destroy(): void;
}

const EMITTERS: readonly SteamEmitterDefinition[] = [
  // Fixed room-space elbow immediately right of the center console.
  {
    x: 610, y: 234, direction: -2.55, spread: 0.34,
    speedMin: 225, speedMax: 305, lifeMin: 0.9, lifeMax: 1.3,
    cadenceMin: 48, cadenceMax: 82
  },
  // Underside coupling on the large upper-right pipe; the pressure jet points down.
  {
    x: 807, y: 47, direction: Math.PI / 2, spread: 0.3,
    speedMin: 240, speedMax: 325, lifeMin: 0.95, lifeMax: 1.35,
    cadenceMin: 52, cadenceMax: 88
  },
  // Seam on the tall vertical pipe running along the far-left edge of the room.
  // The jet shoots diagonally upward-right into the room.
  {
    x: 22, y: 218, direction: -0.88, spread: 0.32,
    speedMin: 220, speedMax: 300, lifeMin: 0.9, lifeMax: 1.28,
    cadenceMin: 54, cadenceMax: 90
  }
] as const;

const MAX_PARTICLES = 168;
const MAX_DIRECTION_OFFSET = Math.PI / 9;

const STAGE_RATE: Record<Level1LightingStage, number> = {
  1: 1,
  2: 1.2,
  3: 0.92,
  4: 0.72,
  5: 1.08
};

const STAGE_VISIBILITY: Record<Level1LightingStage, number> = {
  1: 0.18,
  2: 0.34,
  3: 0.5,
  4: 0.72,
  5: 0.44
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const PUFF_SHAPES = [
  [-6, -2, -3, -7, 2, -8, 7, -4, 8, 1, 4, 7, -2, 8, -7, 4],
  [-7, -3, -2, -8, 4, -7, 8, -2, 6, 5, 1, 8, -5, 6, -8, 1],
  [-5, -6, 1, -8, 6, -5, 8, 1, 5, 7, -1, 8, -7, 4, -8, -2],
  [-8, -1, -5, -6, 0, -8, 6, -6, 8, 0, 6, 6, 0, 8, -6, 5]
] as const;

function makePuff(variant: number): Graphics {
  const shape = PUFF_SHAPES[variant % PUFF_SHAPES.length];
  const puff = new Graphics()
    .poly([...shape]).fill({ color: 0x77848a, alpha: 0.44 })
    .poly(shape.map((value) => Math.round(value * 0.58))).fill({ color: 0x9ba5a8, alpha: 0.28 });
  puff.visible = false;
  return puff;
}

export function createLevel1SteamSystem(
  onJetStart?: () => void,
  emitterDefinitions: readonly SteamEmitterDefinition[] = EMITTERS
): Level1SteamSystem {
  const container = new Container();
  container.alpha = STAGE_VISIBILITY[1];
  const particleLayer = new Container();
  container.addChild(particleLayer);

  const random = seededRandom(0x53544541);
  const emitters: RuntimeSteamEmitter[] = emitterDefinitions.map((emitter, index) => {
    const initialDelayMin = emitter.initialDelayMin ?? index * 24;
    const initialDelayMax = emitter.initialDelayMax ?? initialDelayMin + emitter.cadenceMax * 2;
    return {
      ...emitter,
      spawnTimer: initialDelayMin + random() * Math.max(0, initialDelayMax - initialDelayMin),
      firing: true,
      phaseTimer: 2200 + random() * 3600,
      directionOffset: (random() * 2 - 1) * MAX_DIRECTION_OFFSET,
      falloff: 0.014 + random() * 0.036
    };
  });
  const particles: SteamParticle[] = Array.from({ length: MAX_PARTICLES }, (_, index) => {
    const node = makePuff(index);
    particleLayer.addChild(node);
    return {
      node, active: false, x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, initialSpeed: 1, falloff: 0.02,
      baseScale: 1, phase: 0, lateralBias: 0
    };
  });

  let stage: Level1LightingStage = 1;

  const spawn = (emitter: RuntimeSteamEmitter) => {
    const particle = particles.find((candidate) => !candidate.active);
    if (!particle) return;
    const angle = emitter.direction + emitter.directionOffset + (random() - 0.5) * emitter.spread;
    const speed = emitter.speedMin + random() * (emitter.speedMax - emitter.speedMin);
    const life = emitter.lifeMin + random() * (emitter.lifeMax - emitter.lifeMin);
    Object.assign(particle, {
      active: true,
      x: emitter.x + (random() - 0.5) * 2,
      y: emitter.y + (random() - 0.5) * 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      initialSpeed: speed,
      falloff: emitter.falloff,
      baseScale: 0.32 + random() * 0.78,
      phase: random() * Math.PI * 2,
      lateralBias: random() * 2 - 1
    });
    particle.node.visible = true;
    particle.node.rotation = random() * Math.PI * 2;
  };

  return {
    container,
    setStage(nextStage) {
      stage = nextStage;
      container.alpha = STAGE_VISIBILITY[nextStage];
    },
    update(deltaMs) {
      const deltaSeconds = Math.min(deltaMs / 1000, 0.05);
      const rate = STAGE_RATE[stage];
      for (const emitter of emitters) {
        emitter.phaseTimer -= deltaMs;
        if (emitter.phaseTimer <= 0) {
          emitter.firing = !emitter.firing;
          if (emitter.firing) {
            emitter.phaseTimer = 2800 + random() * 2400;
            emitter.directionOffset = (random() * 2 - 1) * MAX_DIRECTION_OFFSET;
            emitter.falloff = 0.014 + random() * 0.036;
            emitter.spawnTimer = 0;
            onJetStart?.();
          } else {
            emitter.phaseTimer = 1400 + random() * 1600;
          }
        }
        if (!emitter.firing) continue;
        emitter.spawnTimer -= deltaMs * rate;
        while (emitter.spawnTimer <= 0) {
          const amountRoll = random();
          const amount = amountRoll < 0.14 ? 4 : amountRoll < 0.52 ? 3 : 2;
          for (let index = 0; index < amount; index += 1) spawn(emitter);
          emitter.spawnTimer += emitter.cadenceMin + random() * (emitter.cadenceMax - emitter.cadenceMin);
        }
      }

      for (const particle of particles) {
        if (!particle.active) continue;
        particle.life -= deltaSeconds;
        if (particle.life <= 0) {
          particle.active = false;
          particle.node.visible = false;
          continue;
        }
        const age = 1 - particle.life / particle.maxLife;
        const velocityAngle = Math.atan2(particle.vy, particle.vx);
        const speedDecay = Math.pow(particle.falloff, deltaSeconds);
        particle.vx *= speedDecay;
        particle.vy = particle.vy * speedDecay - age * 4 * deltaSeconds;
        const remainingSpeed = Math.min(1, Math.hypot(particle.vx, particle.vy) / Math.max(1, particle.initialSpeed));
        const lateralStrength = Math.min(1, remainingSpeed * 1.8);
        const turbulence = (
          particle.lateralBias * age * 42
          + Math.sin(particle.phase + age * 14) * age * 18
        ) * lateralStrength;
        particle.x += (particle.vx - Math.sin(velocityAngle) * turbulence) * deltaSeconds;
        particle.y += (particle.vy + Math.cos(velocityAngle) * turbulence) * deltaSeconds;
        particle.node.position.set(Math.round(particle.x), Math.round(particle.y));
        particle.node.rotation += Math.sin(particle.phase + age * 8) * deltaSeconds * 0.45;
        const growth = particle.baseScale * (0.78 + age * 0.82);
        particle.node.scale.set(growth, growth * (0.92 + Math.sin(particle.phase) * 0.08));
        particle.node.alpha = Math.min(1, age * 9) * Math.pow(1 - age, 0.76) * 0.9;
      }
    },
    destroy() {}
  };
}
