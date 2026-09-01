export interface SparkParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  bounces: number;
}

export interface SparkStepResult {
  bounced: boolean;
  expired: boolean;
}

export function stepSparkParticle(
  state: SparkParticleState,
  deltaSeconds: number,
  gravity: number,
  floorY: number
): SparkStepResult {
  const step = Math.max(0, Math.min(0.05, deltaSeconds));
  state.vy += gravity * step;
  state.x += state.vx * step;
  state.y += state.vy * step;
  state.life -= step;

  let bounced = false;
  if (state.y >= floorY) {
    state.y = floorY;
    if (state.bounces === 0 && state.vy > 72) {
      state.vy = -state.vy * 0.24;
      state.vx *= 0.56;
      state.bounces += 1;
      state.life = Math.min(state.life, 0.3);
      bounced = true;
    } else {
      state.life = 0;
    }
  }

  return { bounced, expired: state.life <= 0 };
}
