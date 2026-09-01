import { describe, expect, it } from "vitest";
import { stepSparkParticle, type SparkParticleState } from "../src/render/spark-physics";

describe("Level 1 spark physics", () => {
  it("accelerates particles downward", () => {
    const spark: SparkParticleState = { x: 20, y: 10, vx: 12, vy: 0, life: 1, bounces: 0 };
    stepSparkParticle(spark, 0.05, 500, 200);
    expect(spark.vy).toBe(25);
    expect(spark.y).toBeGreaterThan(10);
    expect(spark.x).toBeGreaterThan(20);
  });

  it("bounces once and loses horizontal energy on the floor", () => {
    const spark: SparkParticleState = { x: 20, y: 99, vx: 100, vy: 140, life: 1, bounces: 0 };
    const result = stepSparkParticle(spark, 0.05, 500, 100);
    expect(result.bounced).toBe(true);
    expect(spark.y).toBe(100);
    expect(spark.vy).toBeLessThan(0);
    expect(spark.vx).toBeCloseTo(56);
    expect(spark.bounces).toBe(1);
  });

  it("expires on the second ground contact", () => {
    const spark: SparkParticleState = { x: 20, y: 99, vx: 20, vy: 100, life: 1, bounces: 1 };
    const result = stepSparkParticle(spark, 0.05, 500, 100);
    expect(result.expired).toBe(true);
  });
});
