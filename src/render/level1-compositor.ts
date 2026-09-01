import { BitmapText, BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { UI_FONT } from "../fonts";
import { LEVEL1_SCENE_HEIGHT, LEVEL1_SCENE_WIDTH, type Level1LightingStage } from "./level1-spec";
import {
  cloneTubeLightSettings,
  LEVEL1_STAGE_DARKNESS_DEFAULTS,
  LEVEL1_STAGE_LIGHTS,
  LEVEL1_TUBE_LIGHT_DEFAULTS,
  type TubeLightSettings
} from "./level1-lighting";
import { TubeLightFilter } from "./tube-light-filter";
import { createLevel1SparkSystem } from "./level1-sparks";
import { createLevel1SteamSystem } from "./level1-steam";
import { SparkPixelateFilter } from "./spark-pixelate-filter";

export { LEVEL1_LIGHTING_STAGES, LEVEL1_SCENE_HEIGHT, LEVEL1_SCENE_WIDTH, type Level1LightingStage } from "./level1-spec";
export type { TubeLightSettings } from "./level1-lighting";

export interface Level1CompositorProof {
  readonly container: Container;
  update(deltaMs: number): void;
  setStage(stage: Level1LightingStage): void;
  getStage(): Level1LightingStage;
  getBeaconPosition(): { x: number; y: number };
  destroy(): void;
}

export interface Level1CompositorSoundEvents {
  sparkBurst?(): void;
  steamJetStart?(): void;
  alarmActive?(active: boolean): void;
}

// Bounding box for the selected unified room's mask. The texture mask below
// supplies the chamfered aperture; these bounds only constrain star placement.
const VIEWPORT = { x: 243, y: 97, width: 321, height: 128 } as const;

// Approximate visible-light stellar colors, ordered from blue-white through
// warm orange. The final duplicate intentionally preserves the source palette's
// slight weighting toward its warmest stellar type.
const STAR_COLORS = [
  0x9db4ff, 0xa2b9ff, 0xa7bcff, 0xaabfff, 0xafc3ff,
  0xbaccff, 0xc0d1ff, 0xcad8ff, 0xe4e8ff, 0xedeeff,
  0xfbf8ff, 0xfff9f9, 0xfff5ec, 0xfff4e8, 0xfff1df,
  0xffebd1, 0xffd7ae, 0xffc690, 0xffbe7f, 0xffbb7b,
  0xffbb7b
] as const;

const P = {
  void: 0x020407,
  space: 0x020407,
  wall0: 0x111820,
  wall1: 0x1a222b,
  wall2: 0x26303a,
  edge: 0x4b5660,
  cold: 0x86adc1,
  amber: 0xe2a348,
  amberHot: 0xffc267,
  rust: 0x78503a,
  red: 0x9c2f2d,
  green: 0x557b67,
  label: 0x9aa4a8
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function outlinedRect(x: number, y: number, width: number, height: number, fill: number, edge = P.edge): Graphics {
  return new Graphics()
    .rect(x, y, width, height)
    .fill(fill)
    .stroke({ color: edge, width: 2, alpha: 0.72 });
}

interface SpaceField {
  readonly container: Container;
  readonly starParallaxLayer: Container;
  readonly asteroidParallaxLayer: Container;
  update(deltaMs: number): void;
  destroy(): void;
}

function makeSpace(
  viewportMaskTexture: Texture | undefined,
  asteroidSheetTexture: Texture | undefined,
  getOutputPixelScale: () => number
): SpaceField {
  const layer = new Container();
  const field = new Container();
  const starParallaxLayer = new Container();
  const asteroidParallaxLayer = new Container();
  const viewportMask = viewportMaskTexture
    ? new Sprite(viewportMaskTexture)
    : new Graphics().rect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.width, VIEWPORT.height).fill(0xffffff);
  if (viewportMask instanceof Sprite) {
    viewportMask.width = LEVEL1_SCENE_WIDTH;
    viewportMask.height = LEVEL1_SCENE_HEIGHT;
    viewportMask.roundPixels = true;
  }
  field.mask = viewportMask;
  field.addChild(new Graphics().rect(0, 0, LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT).fill(P.space));

  const shimmerNodes: Array<{
    node: Graphics;
    phase: number;
    speed: number;
    strength: number;
  }> = [];
  const starBands = [
    { speed: 2.2, count: 38, alpha: 0.56, seed: 0x47544c31 },
    { speed: 5.5, count: 34, alpha: 0.76, seed: 0x47544c32 },
    { speed: 10.5, count: 24, alpha: 1, seed: 0x47544c33 }
  ].map((config) => {
    const random = seededRandom(config.seed);
    const band = new Container();
    const stars = new Graphics();
    for (let index = 0; index < config.count; index += 1) {
      const x = VIEWPORT.x + Math.floor(random() * VIEWPORT.width);
      const y = VIEWPORT.y + Math.floor(random() * VIEWPORT.height);
      const bright = random() > 0.84;
      const size = bright ? 2 : 1;
      const color = STAR_COLORS[Math.floor(random() * STAR_COLORS.length)];
      const alpha = Math.min(1, config.alpha * (0.8 + random() * 0.28));
      const haloAlpha = alpha * (bright ? 0.24 : 0.12);
      stars.rect(x - 1, y - 1, size + 2, size + 2).fill({ color, alpha: haloAlpha });
      stars.rect(x + VIEWPORT.width - 1, y - 1, size + 2, size + 2).fill({ color, alpha: haloAlpha });
      if (bright) {
        stars.rect(x - 2, y, size + 4, 1).fill({ color, alpha: alpha * 0.2 });
        stars.rect(x, y - 2, 1, size + 4).fill({ color, alpha: alpha * 0.2 });
        stars.rect(x + VIEWPORT.width - 2, y, size + 4, 1).fill({ color, alpha: alpha * 0.2 });
        stars.rect(x + VIEWPORT.width, y - 2, 1, size + 4).fill({ color, alpha: alpha * 0.2 });
      }
      stars.rect(x, y, size, size).fill({ color, alpha });
      stars.rect(x + VIEWPORT.width, y, size, size).fill({ color, alpha });
      if (bright && index % 2 === 0 && shimmerNodes.length < 14) {
        const shimmer = new Graphics();
        for (const repeatX of [0, VIEWPORT.width]) {
          const centerX = x + repeatX + Math.floor(size / 2);
          const centerY = y + Math.floor(size / 2);
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
        band.addChild(shimmer);
      }
    }
    band.addChildAt(stars, 0);
    starParallaxLayer.addChild(band);
    return { node: band, speed: config.speed, offset: 0 };
  });

  const asteroidColumns = 5;
  const asteroidRows = 2;
  const asteroidFrames = asteroidSheetTexture
    ? Array.from({ length: asteroidColumns * asteroidRows }, (_, index) => new Texture({
      source: asteroidSheetTexture.source,
      frame: new Rectangle(
        (index % asteroidColumns) * (asteroidSheetTexture.width / asteroidColumns),
        Math.floor(index / asteroidColumns) * (asteroidSheetTexture.height / asteroidRows),
        asteroidSheetTexture.width / asteroidColumns,
        asteroidSheetTexture.height / asteroidRows
      )
    }))
    : [];
  const asteroidRandom = seededRandom(0x41535452);
  const displaySizes = [24, 27, 30, 33, 36, 39, 43, 47, 51, 56] as const;
  const asteroidCount = 12;
  const asteroidTravelWidth = VIEWPORT.width + 260;
  const asteroidSlotWidth = asteroidTravelWidth / asteroidCount;
  const asteroids = asteroidFrames.length === 0 ? [] : Array.from({ length: asteroidCount }, (_, index) => {
    const variant = index % asteroidFrames.length;
    const displaySize = displaySizes[variant];
    const depth = displaySize < 36 ? 0 : displaySize < 48 ? 1 : 2;
    const radius = Math.round(displaySize * 0.42);
    const node = new Sprite(asteroidFrames[variant]);
    // The authored rows sit slightly above their cell centres. Pivot around the
    // rock itself so rotation does not make the sprite orbit inside its frame.
    node.anchor.set(0.5, variant < asteroidColumns ? 0.45 : 0.42);
    node.scale.set(displaySize / asteroidFrames[variant].width);
    node.roundPixels = true;
    node.rotation = asteroidRandom() * Math.PI * 2;
    // Staggered slots keep the denser field from spawning in obvious clumps.
    const x = VIEWPORT.x + asteroidSlotWidth * (index + 0.35 + asteroidRandom() * 0.3);
    const lane = (index * 2) % 3;
    const laneProgress = lane / 2;
    const usableHeight = Math.max(1, VIEWPORT.height - radius * 2);
    const y = VIEWPORT.y + radius + usableHeight * laneProgress + (asteroidRandom() - 0.5) * 8;
    node.position.set(x, y);
    node.alpha = depth === 0 ? 0.58 : depth === 1 ? 0.78 : 0.94;
    asteroidParallaxLayer.addChild(node);
    return {
      node,
      x,
      radius,
      speed: depth === 0 ? 4 + asteroidRandom() * 3 : depth === 1 ? 10 + asteroidRandom() * 6 : 20 + asteroidRandom() * 10,
      rotationSpeed: (0.055 + asteroidRandom() * 0.2) * (asteroidRandom() < 0.5 ? -1 : 1)
    };
  });

  // Rare close pass: asteroid only. There is deliberately no window-wide
  // glint/gloss overlay; the approved rock art carries the event by itself.
  const windowEventLayer = new Container();
  const eventRandom = seededRandom(0x57494e44);
  const eventAsteroid = asteroidFrames.length > 0
    ? new Sprite(asteroidFrames[Math.floor(eventRandom() * asteroidFrames.length)])
    : undefined;
  if (eventAsteroid) {
    eventAsteroid.anchor.set(0.5);
    eventAsteroid.roundPixels = true;
    eventAsteroid.visible = false;
    windowEventLayer.addChild(eventAsteroid);
  }
  let windowEventCountdown = 4200 + eventRandom() * 1800;
  let windowEventActive = false;
  let starClock = 0;
  let eventX = 0;
  let eventSpeed = 0;
  let eventRotationSpeed = 0;

  field.addChild(starParallaxLayer, asteroidParallaxLayer, windowEventLayer, viewportMask);
  layer.addChild(field);
  return {
    container: layer,
    starParallaxLayer,
    asteroidParallaxLayer,
    update(deltaMs) {
      starClock += deltaMs;
      const deltaSeconds = deltaMs / 1000;
      const outputPixelScale = Math.max(0.001, getOutputPixelScale());
      const snapToOutputPixel = (value: number) => Math.round(value * outputPixelScale) / outputPixelScale;
      for (const band of starBands) {
        band.offset -= band.speed * deltaSeconds;
        if (band.offset <= -VIEWPORT.width) band.offset += VIEWPORT.width;
        band.node.x = snapToOutputPixel(band.offset);
      }
      for (const shimmer of shimmerNodes) {
        const wave = Math.max(0, Math.sin(starClock * shimmer.speed + shimmer.phase));
        shimmer.node.alpha = Math.pow(wave, 4) * shimmer.strength;
      }
      for (const asteroid of asteroids) {
        asteroid.x -= asteroid.speed * deltaSeconds;
        asteroid.node.rotation += asteroid.rotationSpeed * deltaSeconds;
        if (asteroid.x + asteroid.radius < VIEWPORT.x) {
          const rightmostEdge = asteroids.reduce((edge, candidate) => candidate === asteroid
            ? edge
            : Math.max(edge, candidate.x + candidate.radius), VIEWPORT.x + VIEWPORT.width);
          asteroid.x = Math.max(
            VIEWPORT.x + VIEWPORT.width + asteroid.radius + 70 + asteroidRandom() * 90,
            rightmostEdge + asteroid.radius + 26 + asteroidRandom() * 34
          );
          asteroid.node.y = VIEWPORT.y + asteroid.radius + Math.floor(asteroidRandom() * Math.max(1, VIEWPORT.height - asteroid.radius * 2));
        }
        asteroid.node.x = snapToOutputPixel(asteroid.x);
      }

      windowEventCountdown -= deltaMs;
      if (!windowEventActive && eventAsteroid && windowEventCountdown <= 0) {
        const displaySize = 94 + eventRandom() * 38;
        eventAsteroid.texture = asteroidFrames[Math.floor(eventRandom() * asteroidFrames.length)];
        eventAsteroid.scale.set(displaySize / eventAsteroid.texture.width);
        eventAsteroid.alpha = 1;
        eventAsteroid.y = VIEWPORT.y + 30 + eventRandom() * (VIEWPORT.height - 60);
        eventAsteroid.rotation = eventRandom() * Math.PI * 2;
        eventX = VIEWPORT.x + VIEWPORT.width + displaySize * 0.7;
        eventSpeed = 74 + eventRandom() * 38;
        eventRotationSpeed = (0.08 + eventRandom() * 0.12) * (eventRandom() < 0.5 ? -1 : 1);
        eventAsteroid.visible = true;
        windowEventActive = true;
      }
      if (windowEventActive && eventAsteroid) {
        eventX -= eventSpeed * deltaSeconds;
        eventAsteroid.x = snapToOutputPixel(eventX);
        eventAsteroid.rotation += eventRotationSpeed * deltaSeconds;
        if (eventX < VIEWPORT.x - 110) {
          eventAsteroid.visible = false;
          windowEventActive = false;
          windowEventCountdown = 22000 + eventRandom() * 24000;
        }
      }
    },
    destroy() {
      for (const frame of asteroidFrames) frame.destroy(false);
    }
  };
}

function makeFarWall(texture?: Texture): Container {
  const layer = new Container();
  if (texture) {
    const sprite = new Sprite(texture);
    sprite.width = LEVEL1_SCENE_WIDTH;
    sprite.height = LEVEL1_SCENE_HEIGHT;
    sprite.roundPixels = true;
    layer.addChild(sprite);
    return layer;
  }
  const wall = new Graphics();
  wall.rect(0, 0, LEVEL1_SCENE_WIDTH, VIEWPORT.y).fill(P.wall0);
  wall.rect(0, VIEWPORT.y, VIEWPORT.x, VIEWPORT.height).fill(P.wall1);
  wall.rect(VIEWPORT.x + VIEWPORT.width, VIEWPORT.y, LEVEL1_SCENE_WIDTH - VIEWPORT.x - VIEWPORT.width, VIEWPORT.height).fill(P.wall1);
  wall.rect(0, VIEWPORT.y + VIEWPORT.height, LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT - VIEWPORT.y - VIEWPORT.height).fill(P.wall0);
  layer.addChild(wall);

  const seams = new Graphics();
  for (let x = 18; x < LEVEL1_SCENE_WIDTH; x += 78) {
    seams.rect(x, 8, 2, 36).fill({ color: P.edge, alpha: 0.25 });
    seams.rect(x, 230, 2, 184).fill({ color: P.edge, alpha: 0.18 });
  }
  for (let y = 250; y < 400; y += 54) seams.rect(0, y, LEVEL1_SCENE_WIDTH, 2).fill({ color: P.edge, alpha: 0.18 });
  layer.addChild(seams);

  const leftDepth = new Graphics()
    .poly([0, 54, 58, 54, 78, 76, 78, 212, 56, 232, 0, 232])
    .fill(0x0a0f14)
    .stroke({ color: P.edge, width: 2, alpha: 0.5 });
  layer.addChild(leftDepth);

  layer.addChild(outlinedRect(718, 58, 224, 160, 0x0b1015));
  const doorRecess = new Graphics()
    .poly([750, 77, 915, 77, 929, 91, 929, 205, 735, 205, 735, 91])
    .fill(0x070b0f)
    .stroke({ color: P.edge, width: 2, alpha: 0.65 });
  layer.addChild(doorRecess);

  const farPipes = new Graphics();
  for (let index = 0; index < 4; index += 1) {
    farPipes.rect(92 + index * 8, 60, 4, 145).fill({ color: 0x303941, alpha: 0.8 });
    farPipes.rect(92 + index * 8, 60, 148, 4).fill({ color: 0x303941, alpha: 0.8 });
  }
  layer.addChild(farPipes);

  const farGrilles = new Graphics();
  for (let index = 0; index < 7; index += 1) farGrilles.rect(14 + index * 24, 286, 13, 78).fill({ color: 0x05080b, alpha: 0.8 });
  layer.addChild(farGrilles);
  return layer;
}

function makeStaticRoom(texture?: Texture): Container {
  const layer = new Container();
  if (texture) {
    const sprite = new Sprite(texture);
    sprite.width = LEVEL1_SCENE_WIDTH;
    sprite.height = LEVEL1_SCENE_HEIGHT;
    sprite.roundPixels = true;
    layer.addChild(sprite);
    return layer;
  }

  const floor = new Graphics()
    .poly([0, 310, 960, 310, 960, 420, 0, 420])
    .fill(0x13191f)
    .stroke({ color: P.edge, width: 2, alpha: 0.55 });
  for (let x = 28; x < 960; x += 92) floor.moveTo(x, 314).lineTo(x - 22, 420).stroke({ color: 0x38424a, width: 1, alpha: 0.33 });
  for (let y = 338; y < 420; y += 31) floor.rect(0, y, 960, 1).fill({ color: 0x46515a, alpha: 0.25 });
  layer.addChild(floor);

  const koreRack = outlinedRect(24, 72, 172, 238, 0x0a0e12);
  const rackBands = new Graphics();
  for (let y = 88; y < 296; y += 35) rackBands.rect(34, y, 152, 25).fill(y === 123 ? 0x171f25 : 0x11171c).stroke({ color: 0x3d4850, width: 1 });
  rackBands.rect(70, 126, 74, 58).fill(0x050403).stroke({ color: P.amber, width: 2, alpha: 0.5 });
  rackBands.rect(85, 140, 11, 6).fill(P.amber);
  rackBands.rect(120, 140, 11, 6).fill(P.amber);
  rackBands.rect(91, 163, 34, 4).fill(P.amber);
  layer.addChild(koreRack, rackBands);

  const mainBench = new Graphics()
    .poly([220, 258, 683, 258, 711, 288, 697, 313, 202, 313, 190, 289])
    .fill(0x171d22)
    .stroke({ color: P.edge, width: 2, alpha: 0.72 });
  mainBench.rect(232, 274, 130, 24).fill(0x0b1014);
  mainBench.rect(382, 274, 146, 24).fill(0x0b1014);
  mainBench.rect(548, 274, 118, 24).fill(0x0b1014);
  layer.addChild(mainBench);

  const rightBackplate = outlinedRect(714, 232, 226, 80, 0x11171c);
  layer.addChild(rightBackplate);

  const fixtures = new Graphics();
  fixtures.rect(354, 12, 150, 11).fill(0x090d10).stroke({ color: P.edge, width: 1 });
  fixtures.rect(525, 12, 136, 11).fill(0x090d10).stroke({ color: P.edge, width: 1 });
  fixtures.rect(368, 17, 98, 4).fill({ color: P.cold, alpha: 0.55 });
  fixtures.rect(548, 17, 90, 4).fill({ color: P.cold, alpha: 0.32 });
  layer.addChild(fixtures);

  const props = new Graphics();
  // Dense clusters leave clear walking patches instead of distributing noise evenly.
  const propRects = [
    [44, 329, 42, 25], [89, 338, 28, 17], [57, 360, 52, 19], [121, 350, 19, 32],
    [217, 326, 31, 18], [251, 334, 21, 12], [230, 355, 56, 8], [301, 350, 18, 14],
    [744, 329, 54, 23], [807, 340, 28, 18], [850, 328, 46, 31], [902, 351, 28, 21]
  ] as const;
  for (const [x, y, width, height] of propRects) props.rect(x, y, width, height).fill(0x0a0e12).stroke({ color: 0x3d464c, width: 1 });
  props.circle(170, 367, 20).stroke({ color: 0x303a42, width: 5 });
  props.circle(170, 367, 11).stroke({ color: 0x303a42, width: 3 });
  props.poly([326, 369, 344, 358, 363, 371, 354, 379, 332, 379]).fill(0x15181a);
  props.poly([666, 350, 690, 346, 702, 360, 676, 369]).fill(0x171617);
  layer.addChild(props);
  return layer;
}

function makeForeground(texture?: Texture): Container {
  const layer = new Container();
  if (texture) {
    const regions = [
      { frame: new Rectangle(0, 280, 220, 140), x: -8, y: 280 },
      { frame: new Rectangle(360, 340, 240, 80), x: 360, y: 340 },
      // Pull the authored cable anchors above the viewport so the wires read as
      // attached to the ceiling instead of floating below it.
      { frame: new Rectangle(640, 0, 260, 140), x: 640, y: -28 }
    ] as const;
    for (const region of regions) {
      const sprite = new Sprite(new Texture({ source: texture.source, frame: region.frame }));
      sprite.position.set(region.x, region.y);
      sprite.roundPixels = true;
      layer.addChild(sprite);
    }
    return layer;
  }
  const pipe = new Graphics()
    .moveTo(-36, 399)
    .bezierCurveTo(38, 338, 104, 350, 172, 420)
    .stroke({ color: 0x020405, width: 34 });
  pipe.moveTo(-36, 393).bezierCurveTo(38, 332, 104, 344, 172, 414).stroke({ color: 0x182027, width: 7, alpha: 0.65 });
  const rib = new Graphics()
    .poly([0, 0, 28, 0, 47, 37, 47, 244, 27, 269, 0, 269])
    .fill({ color: 0x030506, alpha: 0.94 })
    .stroke({ color: 0x293139, width: 3, alpha: 0.75 });
  layer.addChild(pipe, rib);
  return layer;
}

function makeWindowCracks(): Graphics {
  const cracks = new Graphics();
  type CrackPath = ReadonlyArray<readonly [number, number]>;
  const paths: readonly CrackPath[] = [
    // One readable impact web, intentionally off-centre.
    [[499, 145], [493, 138], [486, 132], [478, 125], [469, 116], [461, 108]],
    [[499, 145], [499, 136], [501, 126], [506, 116], [510, 106], [513, 98]],
    [[499, 145], [507, 138], [514, 130], [522, 124], [530, 119]],
    [[499, 145], [509, 143], [520, 144], [532, 146], [544, 149]],
    [[499, 145], [507, 152], [515, 160], [522, 170], [531, 181], [541, 194]],
    [[499, 145], [499, 154], [498, 164], [500, 176], [499, 188]],
    [[499, 145], [492, 145], [482, 147], [471, 151], [459, 156], [448, 162]],
    [[499, 145], [493, 152], [487, 160], [480, 171], [472, 184]],

    // Irregular ring fragments and small branches keep the web from reading as
    // a clean icon or mathematically perfect radial burst.
    [[487, 139], [490, 132], [498, 129], [506, 132]],
    [[506, 132], [512, 138], [511, 148], [507, 155]],
    [[507, 155], [500, 160], [493, 157], [487, 151], [487, 139]],
    [[486, 132], [483, 124], [478, 119]],
    [[515, 160], [523, 158], [531, 159], [539, 163]],
    [[480, 171], [472, 169], [466, 164]],
    [[522, 124], [525, 115], [531, 109]],

    // Short corner-origin fractures. They stop well before reaching the impact.
    [[278, 99], [283, 106], [289, 111], [294, 118], [301, 125]],
    [[289, 111], [286, 119], [287, 126]],
    [[529, 99], [525, 106], [520, 112], [517, 120], [514, 127]],
    [[520, 112], [526, 116], [531, 122]],
    [[247, 196], [253, 193], [260, 189], [268, 184], [276, 181]],
    [[260, 189], [259, 197], [263, 204]],
    [[560, 197], [554, 201], [549, 207], [543, 212], [537, 218]],
    [[549, 207], [555, 211], [559, 216]]
  ];

  const drawPaths = (offset: number, color: number, alpha: number, width: number) => {
    for (const path of paths) {
      cracks.moveTo(path[0][0] + offset, path[0][1] + offset);
      for (let index = 1; index < path.length; index += 1) {
        cracks.lineTo(path[index][0] + offset, path[index][1] + offset);
      }
    }
    cracks.stroke({ color, alpha, width });
  };

  drawPaths(1, 0x010306, 0.72, 2);
  drawPaths(0, 0xaab7ba, 0.62, 1);
  cracks.circle(499, 145, 2).fill({ color: 0xd7dede, alpha: 0.72 });
  return cracks;
}

interface TubeLightView {
  readonly settings: TubeLightSettings;
  readonly container: Container;
  readonly glow: Graphics;
  readonly core: Graphics;
}

function createTubeLightView(settings: TubeLightSettings): TubeLightView {
  const container = new Container();
  const glow = new Graphics();
  const core = new Graphics();
  glow.blendMode = "add";
  core.blendMode = "add";
  container.addChild(glow, core);
  return { settings, container, glow, core };
}

function syncTubeLightView(view: TubeLightView): void {
  const { settings, container, glow, core } = view;
  const half = settings.length / 2;
  container.position.set(settings.x, settings.y);
  container.rotation = settings.angle;
  container.alpha = settings.intensity;
  if (settings.id === "emergency-beacon") {
    glow.clear().circle(0, 0, 12).fill({ color: settings.color, alpha: 0.38 });
    glow.filters = [new BlurFilter({ strength: 10, quality: 2 })];
    core.clear()
      .circle(0, 0, 5).fill({ color: settings.color, alpha: 0.94 })
      .roundRect(-2, 3, 4, 13, 2).fill({ color: settings.color, alpha: 0.72 });
    return;
  }
  glow.clear().roundRect(-half - 6, -7, settings.length + 12, 14, 7).fill({ color: settings.color, alpha: 0.32 });
  glow.filters = [new BlurFilter({ strength: 8, quality: 2 })];
  core.clear().roundRect(-half, -2, settings.length, 4, 2).fill({ color: settings.color, alpha: 0.88 });
}

function roomExclusionMask(): Graphics {
  return new Graphics()
    .rect(0, 0, LEVEL1_SCENE_WIDTH, VIEWPORT.y).fill(0xffffff)
    .rect(0, VIEWPORT.y, VIEWPORT.x, VIEWPORT.height).fill(0xffffff)
    .rect(VIEWPORT.x + VIEWPORT.width, VIEWPORT.y, LEVEL1_SCENE_WIDTH - VIEWPORT.x - VIEWPORT.width, VIEWPORT.height).fill(0xffffff)
    .rect(0, VIEWPORT.y + VIEWPORT.height, LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT - VIEWPORT.y - VIEWPORT.height).fill(0xffffff);
}

function roomTextureMask(texture?: Texture): Graphics | Sprite {
  if (!texture) return roomExclusionMask();
  const mask = new Sprite(texture);
  mask.width = LEVEL1_SCENE_WIDTH;
  mask.height = LEVEL1_SCENE_HEIGHT;
  mask.roundPixels = true;
  return mask;
}

export function createLevel1CompositorProof(
  roomTexture?: Texture,
  viewportMaskTexture?: Texture,
  foregroundTexture?: Texture,
  asteroidSheetTexture?: Texture,
  getOutputPixelScale: () => number = () => 1,
  devMode = false,
  soundEvents: Level1CompositorSoundEvents = {}
): Level1CompositorProof {
  const container = new Container();
  container.eventMode = "static";
  container.hitArea = new Rectangle(0, 0, LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT);

  const backdrop = new Graphics().rect(0, 0, LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT).fill(P.void);
  const spaceField = makeSpace(viewportMaskTexture, asteroidSheetTexture, getOutputPixelScale);
  const space = spaceField.container;
  const room = new Container();
  if (roomTexture) {
    const sprite = new Sprite(roomTexture);
    sprite.width = LEVEL1_SCENE_WIDTH;
    sprite.height = LEVEL1_SCENE_HEIGHT;
    sprite.roundPixels = true;
    room.addChild(sprite);
  } else {
    room.addChild(makeFarWall(), makeStaticRoom());
  }
  const tubeLightingFilter = new TubeLightFilter(LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT);
  room.filters = [tubeLightingFilter];
  const windowCracks = makeWindowCracks();
  const foreground = makeForeground(foregroundTexture);
  const steam = createLevel1SteamSystem(soundEvents.steamJetStart);
  const sparks = createLevel1SparkSystem(soundEvents.sparkBurst);
  const pixelatedEffects = new Container();
  const effectsPixelateFilter = new SparkPixelateFilter(2);
  pixelatedEffects.filters = [effectsPixelateFilter];
  pixelatedEffects.filterArea = new Rectangle(0, 0, LEVEL1_SCENE_WIDTH, LEVEL1_SCENE_HEIGHT);
  pixelatedEffects.addChild(windowCracks, steam.container, sparks.container);
  container.addChild(backdrop, room, space, pixelatedEffects, foreground);

  const lighting = new Container();
  const lightRig = new Container();
  const lightMask = roomTextureMask(roomTexture);
  lightRig.mask = lightMask;
  const lights = LEVEL1_TUBE_LIGHT_DEFAULTS.map(cloneTubeLightSettings);
  const beaconSettings = lights.find((light) => light.id === "emergency-beacon");
  const beaconStorageKey = "groundtruth.level1.emergency-beacon-position.v1";
  if (devMode && beaconSettings) {
    try {
      const stored = localStorage.getItem(beaconStorageKey);
      if (stored) {
        const position = JSON.parse(stored) as { x?: number; y?: number };
        if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
          beaconSettings.x = Math.max(0, Math.min(LEVEL1_SCENE_WIDTH, position.x as number));
          beaconSettings.y = Math.max(0, Math.min(LEVEL1_SCENE_HEIGHT, position.y as number));
        }
      }
    } catch {
      // A malformed dev preference should never block the scene from loading.
    }
  }
  const lightViews = new Map(lights.map((settings) => {
    const view = createTubeLightView(settings);
    syncTubeLightView(view);
    lightRig.addChild(view.container);
    return [settings.id, view] as const;
  }));
  const beaconDrag = devMode && beaconSettings
    ? (() => {
        const view = lightViews.get("emergency-beacon");
        if (!view) return undefined;
        const handle = new Container();
        handle.position.set(beaconSettings.x, beaconSettings.y);
        handle.eventMode = "static";
        handle.cursor = "grab";
        handle.hitArea = new Rectangle(-24, -24, 48, 48);
        const marker = new Graphics()
          .circle(0, 0, 11).fill({ color: 0x030506, alpha: 0.72 }).stroke({ color: 0xffc267, width: 1.5, alpha: 0.95 })
          .moveTo(-16, 0).lineTo(16, 0).moveTo(0, -16).lineTo(0, 16)
          .stroke({ color: 0xffc267, width: 1, alpha: 0.8 });
        const label = new BitmapText({
          text: `BEACON ${Math.round(beaconSettings.x)},${Math.round(beaconSettings.y)}`,
          style: { fontFamily: UI_FONT, fontSize: 11, fill: 0xffc267 }
        });
        label.position.set(17, -18);
        label.eventMode = "none";
        handle.addChild(marker, label);
        lightRig.addChild(handle);
        return { handle, label, view, dragging: false };
      })()
    : undefined;
  lighting.addChild(lightRig, lightMask);
  container.addChild(lighting);

  let stage: Level1LightingStage = 1;
  let clock = 0;
  let effectsUpdateAccumulator = 0;
  let lightingSyncAccumulator = 0;
  const effectsFrameMs = 1000 / 30;
  const lightingFrameMs = 1000 / 30;
  const lightingRandom = seededRandom(0x4c494748);
  let mainFlickerPhase: "glow" | "stutter-off" | "stutter-on" = "glow";
  let mainFlickerTimer = 1500 + lightingRandom() * 2100;
  let mainFlickerStutters = 0;
  const advanceMainFlicker = (deltaMs: number) => {
    mainFlickerTimer -= deltaMs;
    while (mainFlickerTimer <= 0) {
      const carry = mainFlickerTimer;
      if (mainFlickerPhase === "glow") {
        mainFlickerStutters = 2 + Math.floor(lightingRandom() * 3);
        mainFlickerPhase = "stutter-off";
        mainFlickerTimer = 45 + lightingRandom() * 85 + carry;
      } else if (mainFlickerPhase === "stutter-off") {
        mainFlickerPhase = "stutter-on";
        mainFlickerTimer = 55 + lightingRandom() * 110 + carry;
      } else {
        mainFlickerStutters -= 1;
        if (mainFlickerStutters > 0) {
          mainFlickerPhase = "stutter-off";
          mainFlickerTimer = 40 + lightingRandom() * 90 + carry;
        } else {
          mainFlickerPhase = "glow";
          mainFlickerTimer = 1300 + lightingRandom() * 2600 + carry;
        }
      }
    }
  };
  const ambientColorForStage = () => stage === 2 || stage === 3 ? P.red : stage === 4 ? P.amber : P.cold;
  const syncLightingFilter = (multipliers: Readonly<Record<string, number>> = {}) => {
    const visibleLights = new Set(LEVEL1_STAGE_LIGHTS[stage]);
    const activeLights = lights
      .filter((light) => visibleLights.has(light.id))
      .map((light) => multipliers[light.id] === undefined
        ? light
        : { ...light, intensity: light.intensity * multipliers[light.id] });
    tubeLightingFilter.setLighting(activeLights, ambientColorForStage(), 1 - LEVEL1_STAGE_DARKNESS_DEFAULTS[stage]);
  };
  const applyStageLights = () => {
    const visibleLights = new Set(LEVEL1_STAGE_LIGHTS[stage]);
    for (const [id, view] of lightViews) {
      view.container.visible = visibleLights.has(id);
      view.container.alpha = view.settings.intensity;
    }
    syncLightingFilter();
  };
  const setStage = (next: Level1LightingStage) => {
    stage = next;
    applyStageLights();
    sparks.setStage(next);
    steam.setStage(next);
    soundEvents.alarmActive?.(LEVEL1_STAGE_LIGHTS[next].includes("emergency-beacon"));
  };
  setStage(1);

  let pointerX = 0;
  let pointerY = 0;
  let easedX = 0;
  let easedY = 0;
  container.on("globalpointermove", (event) => {
    if (beaconDrag?.dragging && beaconSettings) {
      const local = event.getLocalPosition(container);
      beaconSettings.x = Math.max(12, Math.min(LEVEL1_SCENE_WIDTH - 12, local.x));
      beaconSettings.y = Math.max(12, Math.min(LEVEL1_SCENE_HEIGHT - 12, local.y));
      beaconDrag.view.container.position.set(beaconSettings.x, beaconSettings.y);
      beaconDrag.handle.position.set(beaconSettings.x, beaconSettings.y);
      beaconDrag.label.text = `BEACON ${Math.round(beaconSettings.x)},${Math.round(beaconSettings.y)}`;
    }
    pointerX = Math.max(-1, Math.min(1, (event.global.x / LEVEL1_SCENE_WIDTH - 0.5) * 2));
    pointerY = Math.max(-1, Math.min(1, (event.global.y / LEVEL1_SCENE_HEIGHT - 0.5) * 2));
  });
  if (beaconDrag && beaconSettings) {
    beaconDrag.handle.on("pointerdown", (event) => {
      beaconDrag.dragging = true;
      beaconDrag.handle.cursor = "grabbing";
      event.stopPropagation();
    });
    const finishBeaconDrag = () => {
      if (!beaconDrag.dragging) return;
      beaconDrag.dragging = false;
      beaconDrag.handle.cursor = "grab";
      try {
        localStorage.setItem(beaconStorageKey, JSON.stringify({ x: beaconSettings.x, y: beaconSettings.y }));
      } catch {
        // Persistence is a convenience; dragging remains functional without it.
      }
    };
    container.on("pointerup", finishBeaconDrag);
    container.on("pointerupoutside", finishBeaconDrag);
  }
  container.on("pointerout", () => { pointerX = 0; pointerY = 0; });

  const parallax = [
    { layer: spaceField.starParallaxLayer, amount: 4, snap: true },
    { layer: spaceField.asteroidParallaxLayer, amount: 6.25, snap: true },
    { layer: foreground, amount: 7, snap: true }
  ] as const;

  return {
    container,
    update(deltaMs) {
      clock += deltaMs;
      spaceField.update(deltaMs);
      effectsUpdateAccumulator += deltaMs;
      if (effectsUpdateAccumulator >= effectsFrameMs) {
        const effectsDelta = Math.min(effectsUpdateAccumulator, effectsFrameMs * 2);
        effectsUpdateAccumulator %= effectsFrameMs;
        steam.update(effectsDelta);
        sparks.update(effectsDelta);
      }
      const smoothing = 1 - Math.pow(0.001, deltaMs / 1000);
      easedX += (pointerX - easedX) * smoothing;
      easedY += (pointerY - easedY) * smoothing;
      const outputPixelScale = Math.max(0.001, getOutputPixelScale());
      const snapToOutputPixel = (offset: number) => Math.round(offset * outputPixelScale) / outputPixelScale;
      for (const item of parallax) {
        const offsetX = -easedX * item.amount;
        const offsetY = -easedY * item.amount * 0.55;
        item.layer.position.set(
          item.snap ? snapToOutputPixel(offsetX) : offsetX,
          item.snap ? snapToOutputPixel(offsetY) : offsetY
        );
      }
      const lightMultipliers: Record<string, number> = {};
      if (stage === 1) {
        // Random long glows are interrupted by two to four quick stutters,
        // followed by another independently timed glow interval.
        advanceMainFlicker(deltaMs);
        const primaryOn = mainFlickerPhase !== "stutter-off";
        lightMultipliers["cold-overhead"] = primaryOn
          ? (mainFlickerPhase === "stutter-on" ? 1.24 : 1.16) + Math.sin(clock * 0.009) * 0.06
          : 0.08;
        const cold = lightViews.get("cold-overhead");
        if (cold) cold.container.alpha = cold.settings.intensity * lightMultipliers["cold-overhead"];

        const leftCycle = (clock + 670) % 3300;
        const leftOn = leftCycle < 820
          || (leftCycle >= 1040 && leftCycle < 2150)
          || leftCycle >= 2460;
        lightMultipliers["cold-left"] = leftOn
          ? 0.76 + Math.sin(clock * 0.0073 + 1.7) * 0.05
          : 0.06;
        const coldLeft = lightViews.get("cold-left");
        if (coldLeft) coldLeft.container.alpha = coldLeft.settings.intensity * lightMultipliers["cold-left"];

        // Revolve the beacon's directional segment continuously; the shader's
        // forward mask turns that rotation into a sweeping red pool of light.
        const beacon = lightViews.get("emergency-beacon");
        if (beacon) {
          beacon.settings.angle = -0.72 + clock * 0.0048;
          beacon.container.rotation = beacon.settings.angle;
          lightMultipliers["emergency-beacon"] = 1.08 + Math.sin(clock * 0.0048) * 0.06;
          beacon.container.alpha = beacon.settings.intensity * lightMultipliers["emergency-beacon"];
        }
      }
      const kore = lightViews.get("kore-rack");
      if (kore?.container.visible) {
        lightMultipliers["kore-rack"] = 0.84 + Math.sin(clock * 0.0028) * 0.08;
        kore.container.alpha = kore.settings.intensity * lightMultipliers["kore-rack"];
      }
      lightingSyncAccumulator += deltaMs;
      if (Object.keys(lightMultipliers).length > 0 && lightingSyncAccumulator >= lightingFrameMs) {
        lightingSyncAccumulator %= lightingFrameMs;
        syncLightingFilter(lightMultipliers);
      }
    },
    setStage,
    getStage: () => stage,
    getBeaconPosition: () => ({
      x: beaconSettings?.x ?? 785,
      y: beaconSettings?.y ?? 46
    }),
    destroy() {
      container.removeAllListeners();
      room.filters = [];
      tubeLightingFilter.destroy();
      steam.destroy();
      sparks.destroy();
      pixelatedEffects.filters = [];
      effectsPixelateFilter.destroy();
      container.destroy({ children: true });
      spaceField.destroy();
    }
  };
}
