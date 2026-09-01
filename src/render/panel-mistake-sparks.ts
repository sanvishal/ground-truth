import { BlurFilter, Container, Graphics, Rectangle } from "pixi.js";

export interface PanelSparkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanelSparkParticle {
  node: Graphics;
  glow: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  maxLifeMs: number;
}

interface PanelSparkFlash {
  node: Graphics;
  lifeMs: number;
  maxLifeMs: number;
}

export function createPanelMistakeSparks() {
  const container = new Container();
  container.zIndex = 3_200_000;
  container.eventMode = "none";
  const flashLayer = new Container();
  const glowLayer = new Container();
  const particleLayer = new Container();
  glowLayer.filters = [new BlurFilter({ strength: 3, quality: 1 })];
  glowLayer.filterArea = new Rectangle(0, 0, 960, 420);
  container.addChild(glowLayer, flashLayer, particleLayer);
  const particles: PanelSparkParticle[] = [];
  const flashes: PanelSparkFlash[] = [];

  const makeFlash = (x: number, y: number) => {
    const node = new Graphics()
      .circle(0, 0, 18).fill({ color: 0xff8c32, alpha: 0.18 })
      .rect(-13, -2, 26, 4).fill({ color: 0xffa42e, alpha: 0.58 })
      .rect(-2, -13, 4, 26).fill({ color: 0xffa42e, alpha: 0.58 })
      .rect(-7, -1, 14, 2).fill({ color: 0xffefad, alpha: 1 })
      .rect(-1, -7, 2, 14).fill({ color: 0xffefad, alpha: 1 });
    node.position.set(x, y);
    node.blendMode = "add";
    flashLayer.addChild(node);
    flashes.push({ node, lifeMs: 230, maxLifeMs: 230 });
  };

  const burst = (bounds: PanelSparkBounds) => {
    const originCount = 1 + Math.floor(Math.random() * 2);
    for (let originIndex = 0; originIndex < originCount; originIndex += 1) {
      const originX = bounds.x + 24 + Math.random() * Math.max(1, bounds.width - 48);
      const originY = bounds.y + 20 + Math.random() * Math.max(1, bounds.height - 40);
      makeFlash(originX, originY);
      const particleCount = 9 + Math.floor(Math.random() * 7);
      for (let index = 0; index < particleCount; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 145 + Math.random() * 210;
        const maxLifeMs = 420 + Math.random() * 420;
        const node = new Graphics();
        const glow = new Graphics();
        node.blendMode = "add";
        glow.blendMode = "add";
        particleLayer.addChild(node);
        glowLayer.addChild(glow);
        particles.push({
          node,
          glow,
          x: originX + (Math.random() - 0.5) * 8,
          y: originY + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 45,
          lifeMs: maxLifeMs,
          maxLifeMs
        });
      }
    }
  };

  const update = (deltaMs: number) => {
    const deltaSeconds = deltaMs / 1000;
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.lifeMs -= deltaMs;
      if (particle.lifeMs <= 0) {
        particle.node.destroy();
        particle.glow.destroy();
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vy += 620 * deltaSeconds;
      particle.vx *= Math.pow(0.35, deltaSeconds);
      const strength = particle.lifeMs / particle.maxLifeMs;
      const tailX = -particle.vx * 0.028;
      const tailY = -particle.vy * 0.028;
      particle.glow
        .clear()
        .moveTo(0, 0)
        .lineTo(tailX, tailY)
        .stroke({ color: 0xff8a24, width: 6, alpha: strength * 0.46 });
      particle.node
        .clear()
        .moveTo(0, 0)
        .lineTo(tailX, tailY)
        .stroke({ color: 0xff8a24, width: 4, alpha: strength * 0.42 })
        .moveTo(0, 0)
        .lineTo(tailX * 0.9, tailY * 0.9)
        .stroke({ color: 0xffc044, width: 2, alpha: strength * 0.9 })
        .moveTo(0, 0)
        .lineTo(tailX * 0.72, tailY * 0.72)
        .stroke({ color: 0xfff2bd, width: 1, alpha: strength });
      particle.node.position.set(Math.round(particle.x), Math.round(particle.y));
      particle.glow.position.copyFrom(particle.node.position);
    }
    for (let index = flashes.length - 1; index >= 0; index -= 1) {
      const flash = flashes[index];
      flash.lifeMs -= deltaMs;
      if (flash.lifeMs <= 0) {
        flash.node.destroy();
        flashes.splice(index, 1);
        continue;
      }
      const strength = flash.lifeMs / flash.maxLifeMs;
      flash.node.alpha = strength;
      flash.node.scale.set(0.82 + (1 - strength) * 0.65);
    }
  };

  return {
    container,
    burst,
    update,
    destroy() {
      particles.length = 0;
      flashes.length = 0;
      container.destroy({ children: true });
    }
  };
}
