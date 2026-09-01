import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { TubeLightSettings } from "./level1-lighting";
import { createLevel1SparkSystem, type SparkEmitterDefinition } from "./level1-sparks";
import { createLevel1SteamSystem, type SteamEmitterDefinition } from "./level1-steam";
import { TubeLightFilter } from "./tube-light-filter";
import { isEnvironmentAbnormal, type Level2State } from "../sim/level2";

const SCENE_WIDTH = 960;
const SCENE_HEIGHT = 420;
const PORTHOLE = { x: 834, y: 173, radiusX: 44, radiusY: 45 } as const;
const STAR_TILE_WIDTH = PORTHOLE.radiusX * 2;

const LEVEL2_SPARK_EMITTERS: readonly SparkEmitterDefinition[] = [
  { x: 655, y: 13, floorY: 382, direction: 1.34, spread: 0.72, burstMin: 2, burstMax: 10, intervalMin: 4300, intervalMax: 8800, speedMin: 74, speedMax: 190 },
  { x: 718, y: 20, floorY: 382, direction: 1.84, spread: 0.68, burstMin: 2, burstMax: 9, intervalMin: 5200, intervalMax: 9400, speedMin: 70, speedMax: 180 },
  { x: 632, y: 358, floorY: 384, direction: -1.55, spread: 1.05, burstMin: 3, burstMax: 14, intervalMin: 3200, intervalMax: 7200, speedMin: 126, speedMax: 255 }
] as const;

const LEVEL2_STEAM_EMITTERS: readonly SteamEmitterDefinition[] = [
  // Three damaged temperature-vent seams. Wide spread gives every puff a new angle.
  { x: 559, y: 151, direction: 2.35, spread: 1.28, speedMin: 105, speedMax: 172, lifeMin: 0.72, lifeMax: 1.12, cadenceMin: 180, cadenceMax: 310, initialDelayMin: 80, initialDelayMax: 620 },
  { x: 661, y: 151, direction: 0.8, spread: 1.28, speedMin: 105, speedMax: 172, lifeMin: 0.72, lifeMax: 1.12, cadenceMin: 195, cadenceMax: 330, initialDelayMin: 560, initialDelayMax: 1180 },
  { x: 611, y: 216, direction: 1.42, spread: 1.42, speedMin: 98, speedMax: 165, lifeMin: 0.76, lifeMax: 1.18, cadenceMin: 210, cadenceMax: 350, initialDelayMin: 1080, initialDelayMax: 1760 },
  // One leaking coupling on the pipe above the door, aimed downward.
  { x: 840, y: 42, direction: Math.PI / 2, spread: 0.32, speedMin: 168, speedMax: 232, lifeMin: 0.88, lifeMax: 1.28, cadenceMin: 66, cadenceMax: 110, initialDelayMin: 480, initialDelayMax: 1420 }
] as const;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function mixColor(from: number, to: number, amount: number): number {
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * amount);
  return channel(16) << 16 | channel(8) << 8 | channel(0);
}

export interface Level2LightingProof {
  readonly container: Container;
  setRuntimeState(state: Level2State): void;
  update(deltaMs: number): void;
  destroy(): void;
}

export interface Level2LightingSoundEvents {
  sparkBurst?(): void;
  steamJetStart?(): void;
}

export function createLevel2LightingProof(
  roomTexture: Texture,
  alarmRoomTexture: Texture,
  soundEvents: Level2LightingSoundEvents = {}
): Level2LightingProof {
  const container = new Container();
  container.hitArea = new Rectangle(0, 0, SCENE_WIDTH, SCENE_HEIGHT);

  const backdrop = new Graphics()
    .rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT)
    .fill(0x020407);

  const portholeField = new Container();
  const portholeMask = new Graphics()
    .ellipse(PORTHOLE.x, PORTHOLE.y, PORTHOLE.radiusX, PORTHOLE.radiusY)
    .fill(0xffffff);
  portholeField.mask = portholeMask;
  portholeField.addChild(
    new Graphics()
      .ellipse(PORTHOLE.x, PORTHOLE.y, PORTHOLE.radiusX + 2, PORTHOLE.radiusY + 2)
      .fill(0x010308)
  );

  const random = seededRandom(0x47543250);
  const farStars = new Container();
  const nearStars = new Container();
  const farStarPixels = new Graphics();
  const nearStarPixels = new Graphics();
  const shimmerNodes: Array<{ node: Graphics; phase: number; speed: number; strength: number }> = [];
  farStars.addChild(farStarPixels);
  nearStars.addChild(nearStarPixels);
  for (let index = 0; index < 38; index += 1) {
    const x = PORTHOLE.x - PORTHOLE.radiusX + random() * STAR_TILE_WIDTH;
    const y = PORTHOLE.y - PORTHOLE.radiusY + random() * PORTHOLE.radiusY * 2;
    const near = random() > 0.76;
    const color = random() > 0.82 ? 0x9db4ff : random() > 0.5 ? 0xe4e8ff : 0xffebd1;
    const target = near ? nearStarPixels : farStarPixels;
    const layer = near ? nearStars : farStars;
    const size = near ? 2 : 1;
    for (const tileOffset of [0, STAR_TILE_WIDTH]) {
      target.rect(Math.round(x + tileOffset), Math.round(y), size, size).fill({
        color,
        alpha: near ? 0.9 : 0.58
      });
    }
    if (near && shimmerNodes.length < 6) {
      const shimmer = new Graphics();
      for (const tileOffset of [0, STAR_TILE_WIDTH]) {
        const centerX = Math.round(x + tileOffset + size / 2);
        const centerY = Math.round(y + size / 2);
        shimmer.rect(centerX - 3, centerY, 7, 1).fill(color);
        shimmer.rect(centerX, centerY - 3, 1, 7).fill(color);
      }
      shimmer.alpha = 0;
      shimmerNodes.push({
        node: shimmer,
        phase: random() * Math.PI * 2,
        speed: 0.0018 + random() * 0.0016,
        strength: 0.78 + random() * 0.22
      });
      layer.addChild(shimmer);
    }
  }
  portholeField.addChild(farStars, nearStars);

  const room = new Sprite(roomTexture);
  room.width = SCENE_WIDTH;
  room.height = SCENE_HEIGHT;
  // The room and its lighting filter must share the same continuous transform.
  // Snapping only the room sprite to output pixels shifts the authored lamp
  // fixture beneath the filter whenever the responsive canvas scale changes.
  room.roundPixels = false;
  const lighting = new TubeLightFilter(SCENE_WIDTH, SCENE_HEIGHT);
  const growLight: TubeLightSettings = {
    id: "level2-grow-array",
    label: "GROW ARRAY",
    x: 406,
    y: 32,
    length: 126,
    reach: 650,
    angle: 0,
    intensity: 0.16,
    color: 0x5fba69,
    coneAngle: 0.74
  };
  const leftCornerLight: TubeLightSettings = {
    id: "level2-left-corner",
    label: "LEFT CORNER WORK LIGHT",
    x: 92,
    y: 34,
    length: 82,
    reach: 440,
    angle: 0,
    intensity: 0.76,
    color: 0xe2a348
  };
  const rightCornerLight: TubeLightSettings = {
    id: "level2-right-corner",
    label: "RIGHT CORNER FLICKER",
    x: 868,
    y: 34,
    length: 84,
    reach: 480,
    angle: 0,
    intensity: 1.28,
    color: 0xb7b997
  };
  lighting.setLighting([growLight, leftCornerLight, rightCornerLight], 0x3a362e, 0.1);
  let growTargetIntensity = 0.16;
  let growTargetColor = 0x5fba69;
  let ambientColor = 0x3a362e;
  let ambientStrength = 0.1;
  let ambientTargetStrength = 0.1;
  room.filters = [lighting];

  const sparks = createLevel1SparkSystem(soundEvents.sparkBurst, LEVEL2_SPARK_EMITTERS);
  sparks.setStage(2);
  const steam = createLevel1SteamSystem(soundEvents.steamJetStart, LEVEL2_STEAM_EMITTERS);
  steam.setStage(4);

  container.addChild(backdrop, portholeField, portholeMask, room, steam.container, sparks.container);

  let clock = 0;
  let farTravel = 0;
  let nearTravel = 0;
  const flickerRandom = seededRandom(0x4c32464c);
  let nextFlickerAt = 2200 + flickerRandom() * 2800;
  let flickerEndsAt = 0;
  let flickering = false;
  let nextLeftFlickerAt = 2900 + flickerRandom() * 3600;
  let leftFlickerEndsAt = 0;
  let leftFlickering = false;
  return {
    container,
    setRuntimeState(state) {
      const environmentAbnormal = isEnvironmentAbnormal(state);
      room.texture = environmentAbnormal ? alarmRoomTexture : roomTexture;
      growTargetColor = environmentAbnormal ? 0xe1322f : state.ignition.solved ? 0x82c98a : 0x5fba69;
      // Red carries much less perceived luminance than the powered green, so it
      // needs a stronger multiplier to produce an equally readable room throw.
      growTargetIntensity = environmentAbnormal ? 3 : state.plant.transferred ? 0.18 : 1.48;
      ambientTargetStrength = environmentAbnormal ? 0.2 : state.plant.transferred ? 0.07 : state.ignition.solved ? 0.18 : 0.1;
      ambientColor = environmentAbnormal ? 0x492826 : state.plant.transferred ? 0x2b382e : state.ignition.solved ? 0x4b6050 : 0x3a362e;
    },
    update(deltaMs) {
      clock += deltaMs;
      const lightEase = 1 - Math.exp(-deltaMs / 1_850);
      growLight.intensity += (growTargetIntensity - growLight.intensity) * lightEase;
      growLight.color = mixColor(growLight.color, growTargetColor, lightEase);
      ambientStrength += (ambientTargetStrength - ambientStrength) * lightEase;
      farTravel = (farTravel + deltaMs * 0.006) % STAR_TILE_WIDTH;
      nearTravel = (nearTravel + deltaMs * 0.014) % STAR_TILE_WIDTH;
      farStars.position.set(-Math.round(farTravel), 0);
      nearStars.position.set(-Math.round(nearTravel), Math.round(Math.sin(clock * 0.0012)));
      nearStars.alpha = 0.82 + Math.sin(clock * 0.0032) * 0.14;
      for (const shimmer of shimmerNodes) {
        const wave = Math.max(0, Math.sin(clock * shimmer.speed + shimmer.phase));
        shimmer.node.alpha = Math.pow(wave, 4) * shimmer.strength;
      }
      if (!flickering && clock >= nextFlickerAt) {
        flickering = true;
        flickerEndsAt = clock + 180 + flickerRandom() * 420;
      }
      if (flickering) {
        const flutter = Math.sin(clock * 0.095) + Math.sin(clock * 0.173 + 1.7);
        rightCornerLight.intensity = flutter > -0.15 ? 1.28 : 0.08;
        if (clock >= flickerEndsAt) {
          flickering = false;
          rightCornerLight.intensity = 1.28;
          nextFlickerAt = clock + 3400 + flickerRandom() * 5200;
        }
      }
      if (!leftFlickering && clock >= nextLeftFlickerAt) {
        leftFlickering = true;
        leftFlickerEndsAt = clock + 160 + flickerRandom() * 360;
      }
      if (leftFlickering) {
        const flutter = Math.sin(clock * 0.087 + 0.8) + Math.sin(clock * 0.151 + 2.4);
        leftCornerLight.intensity = flutter > -0.22 ? 0.76 : 0.06;
        if (clock >= leftFlickerEndsAt) {
          leftFlickering = false;
          leftCornerLight.intensity = 0.76;
          nextLeftFlickerAt = clock + 3800 + flickerRandom() * 6000;
        }
      }
      lighting.setLighting([growLight, leftCornerLight, rightCornerLight], ambientColor, ambientStrength);
      sparks.update(deltaMs);
      steam.update(deltaMs);
    },
    destroy() {
      room.filters = [];
      sparks.destroy();
      steam.destroy();
      lighting.destroy();
      container.destroy({ children: true });
    }
  };
}
