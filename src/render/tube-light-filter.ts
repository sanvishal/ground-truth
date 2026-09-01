import { Filter, GlProgram, GpuProgram, UniformGroup } from "pixi.js";
import type { TubeLightSettings } from "./level1-lighting";

const MAX_LIGHTS = 8;

// Source-informed Pixi v8 adaptation of pixijs-userland/lights' diffuse model:
// Lambert N·L response plus constant/linear/quadratic attenuation. Unlike the
// v7 plugin, this operates in one filter pass, derives a restrained pseudo-normal
// from the authored room texture, and measures distance to a tube segment.
// https://github.com/pixijs-userland/lights

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vSceneCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec2 uSceneSize;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    // Keep authored lamp coordinates in the room's fixed 960x420 space.
    // Filter texture UVs can include renderer padding and vary with output
    // scale, which made the light source slide across the fixture on resize.
    vSceneCoord = aPosition * uSceneSize;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vSceneCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec2 uSceneSize;
uniform vec4 uAmbientColor;
uniform float uLightCount;
uniform float uNormalStrength;
uniform vec4 uLightSegments[${MAX_LIGHTS}];
uniform vec4 uLightColors[${MAX_LIGHTS}];
uniform vec4 uLightData[${MAX_LIGHTS}];

float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 straightColor(vec2 uv) {
    vec4 sampleColor = texture(uTexture, uv);
    return sampleColor.a > 0.0 ? sampleColor.rgb / sampleColor.a : vec3(0.0);
}

void main(void)
{
    vec4 sampleColor = texture(uTexture, vTextureCoord);
    if (sampleColor.a <= 0.0) {
        finalColor = sampleColor;
        return;
    }

    vec3 diffuseColor = sampleColor.rgb / sampleColor.a;
    vec2 texel = uInputSize.zw;
    float leftLum = luminance(straightColor(vTextureCoord - vec2(texel.x, 0.0)));
    float rightLum = luminance(straightColor(vTextureCoord + vec2(texel.x, 0.0)));
    float upLum = luminance(straightColor(vTextureCoord - vec2(0.0, texel.y)));
    float downLum = luminance(straightColor(vTextureCoord + vec2(0.0, texel.y)));
    vec3 normal = normalize(vec3(
        (leftLum - rightLum) * uNormalStrength,
        (upLum - downLum) * uNormalStrength,
        1.0
    ));

    vec2 pixel = vSceneCoord;
    vec3 ambientTint = mix(vec3(1.0), uAmbientColor.rgb, 0.42);
    vec3 intensity = ambientTint * uAmbientColor.a;

    for (int index = 0; index < ${MAX_LIGHTS}; index++) {
        if (float(index) >= uLightCount) break;
        vec2 start = uLightSegments[index].xy;
        vec2 end = uLightSegments[index].zw;
        vec2 segment = end - start;
        float segmentLengthSquared = max(dot(segment, segment), 0.001);
        float along = clamp(dot(pixel - start, segment) / segmentLengthSquared, 0.0, 1.0);
        vec2 closest = start + segment * along;
        vec2 delta = pixel - closest;
        float reach = max(uLightData[index].z, 1.0);
        float distanceRatio = length(delta) / reach;
        if (distanceRatio >= 1.0) continue;

        vec2 direction = normalize(uLightData[index].xy);
        float forward = dot(delta, direction);
        float directionalMask = smoothstep(-8.0, 18.0, forward);
        float edgeMask = 1.0 - smoothstep(0.72, 1.0, distanceRatio);
        float coneMask = 1.0;
        float coneAngle = uLightData[index].w;
        if (coneAngle > 0.0) {
            vec2 center = (start + end) * 0.5;
            vec2 fromCenter = pixel - center;
            float axial = max(0.0, dot(fromCenter, direction));
            vec2 lateralAxis = vec2(-direction.y, direction.x);
            float lateral = abs(dot(fromCenter, lateralAxis));
            float sourceHalfWidth = length(segment) * 0.5;
            float coneHalfWidth = sourceHalfWidth + axial * tan(coneAngle);
            coneMask = 1.0 - smoothstep(coneHalfWidth * 0.78, coneHalfWidth, lateral);
        }

        vec3 lightVector = normalize(vec3(-delta / reach, 0.48));
        float lambert = max(dot(normal, lightVector), 0.0);
        float materialResponse = 0.2 + lambert * 0.8;

        // Same attenuation shape used by pixijs-userland/lights, tuned for a
        // shallow 2D room rather than a normal-mapped 3D plane.
        float attenuation = 1.0 / (0.75 + 1.6 * distanceRatio + 4.8 * distanceRatio * distanceRatio);
        vec3 lightColor = uLightColors[index].rgb * uLightColors[index].a;
        intensity += lightColor * attenuation * directionalMask * edgeMask * coneMask * materialResponse * 2.35;
    }

    vec3 litColor = diffuseColor * max(intensity, vec3(0.0));
    finalColor = vec4(litColor * sampleColor.a, sampleColor.a);
}
`;

const wgsl = `
struct GlobalFilterUniforms {
    uInputSize: vec4<f32>,
    uInputPixel: vec4<f32>,
    uInputClamp: vec4<f32>,
    uOutputFrame: vec4<f32>,
    uGlobalFrame: vec4<f32>,
    uOutputTexture: vec4<f32>,
};

struct TubeLightingUniforms {
    uSceneSize: vec2<f32>,
    uLightCount: f32,
    uNormalStrength: f32,
    uAmbientColor: vec4<f32>,
    uLightSegments: array<vec4<f32>, ${MAX_LIGHTS}>,
    uLightColors: array<vec4<f32>, ${MAX_LIGHTS}>,
    uLightData: array<vec4<f32>, ${MAX_LIGHTS}>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> tubeLightingUniforms: TubeLightingUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) sceneCoord: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    let uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
    let sceneCoord = aPosition * tubeLightingUniforms.uSceneSize;
    return VSOutput(vec4(position, 0.0, 1.0), uv, sceneCoord);
}

fn luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

fn straightColor(uv: vec2<f32>) -> vec3<f32> {
    let sampleColor = textureSample(uTexture, uSampler, uv);
    if (sampleColor.a > 0.0) { return sampleColor.rgb / sampleColor.a; }
    return vec3(0.0);
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) sceneCoord: vec2<f32>) -> @location(0) vec4<f32> {
    let sampleColor = textureSample(uTexture, uSampler, uv);
    if (sampleColor.a <= 0.0) { return sampleColor; }
    let diffuseColor = sampleColor.rgb / sampleColor.a;
    let texel = gfu.uInputSize.zw;
    let leftLum = luminance(straightColor(uv - vec2(texel.x, 0.0)));
    let rightLum = luminance(straightColor(uv + vec2(texel.x, 0.0)));
    let upLum = luminance(straightColor(uv - vec2(0.0, texel.y)));
    let downLum = luminance(straightColor(uv + vec2(0.0, texel.y)));
    let normal = normalize(vec3(
        (leftLum - rightLum) * tubeLightingUniforms.uNormalStrength,
        (upLum - downLum) * tubeLightingUniforms.uNormalStrength,
        1.0
    ));
    let pixel = sceneCoord;
    let ambientTint = mix(vec3(1.0), tubeLightingUniforms.uAmbientColor.rgb, vec3(0.42));
    var intensity = ambientTint * tubeLightingUniforms.uAmbientColor.a;

    for (var index: i32 = 0; index < ${MAX_LIGHTS}; index = index + 1) {
        if (f32(index) >= tubeLightingUniforms.uLightCount) { break; }
        let segmentData = tubeLightingUniforms.uLightSegments[index];
        let start = segmentData.xy;
        let end = segmentData.zw;
        let segment = end - start;
        let segmentLengthSquared = max(dot(segment, segment), 0.001);
        let along = clamp(dot(pixel - start, segment) / segmentLengthSquared, 0.0, 1.0);
        let closest = start + segment * along;
        let delta = pixel - closest;
        let lightData = tubeLightingUniforms.uLightData[index];
        let reach = max(lightData.z, 1.0);
        let distanceRatio = length(delta) / reach;
        if (distanceRatio >= 1.0) { continue; }
        let direction = normalize(lightData.xy);
        let forward = dot(delta, direction);
        let directionalMask = smoothstep(-8.0, 18.0, forward);
        let edgeMask = 1.0 - smoothstep(0.72, 1.0, distanceRatio);
        var coneMask = 1.0;
        let coneAngle = lightData.w;
        if (coneAngle > 0.0) {
            let center = (start + end) * 0.5;
            let fromCenter = pixel - center;
            let axial = max(0.0, dot(fromCenter, direction));
            let lateralAxis = vec2(-direction.y, direction.x);
            let lateral = abs(dot(fromCenter, lateralAxis));
            let sourceHalfWidth = length(segment) * 0.5;
            let coneHalfWidth = sourceHalfWidth + axial * tan(coneAngle);
            coneMask = 1.0 - smoothstep(coneHalfWidth * 0.78, coneHalfWidth, lateral);
        }
        let lightVector = normalize(vec3(-delta / reach, 0.48));
        let lambert = max(dot(normal, lightVector), 0.0);
        let materialResponse = 0.2 + lambert * 0.8;
        let attenuation = 1.0 / (0.75 + 1.6 * distanceRatio + 4.8 * distanceRatio * distanceRatio);
        let lightColor = tubeLightingUniforms.uLightColors[index].rgb * tubeLightingUniforms.uLightColors[index].a;
        intensity += lightColor * attenuation * directionalMask * edgeMask * coneMask * materialResponse * 2.35;
    }
    let litColor = diffuseColor * max(intensity, vec3(0.0));
    return vec4(litColor * sampleColor.a, sampleColor.a);
}
`;

export class TubeLightFilter extends Filter {
  private readonly lightingUniforms: UniformGroup;
  private readonly segments: Float32Array;
  private readonly colors: Float32Array;
  private readonly data: Float32Array;
  private readonly ambient: Float32Array;

  constructor(sceneWidth: number, sceneHeight: number) {
    const segments = new Float32Array(MAX_LIGHTS * 4);
    const colors = new Float32Array(MAX_LIGHTS * 4);
    const data = new Float32Array(MAX_LIGHTS * 4);
    const ambient = new Float32Array([1, 1, 1, 0.15]);
    const lightingUniforms = new UniformGroup({
      uSceneSize: { value: new Float32Array([sceneWidth, sceneHeight]), type: "vec2<f32>" },
      uLightCount: { value: 0, type: "f32" },
      uNormalStrength: { value: 2.4, type: "f32" },
      uAmbientColor: { value: ambient, type: "vec4<f32>" },
      uLightSegments: { value: segments, type: "vec4<f32>", size: MAX_LIGHTS },
      uLightColors: { value: colors, type: "vec4<f32>", size: MAX_LIGHTS },
      uLightData: { value: data, type: "vec4<f32>", size: MAX_LIGHTS }
    });
    super({
      // Pixi defaults vertex shaders to highp and fragment shaders to mediump.
      // uInputSize is shared by both stages, so WebGL requires identical
      // precision or the program fails to link and the filtered room goes black.
      glProgram: GlProgram.from({
        vertex,
        fragment,
        name: "groundtruth-tube-light",
        preferredVertexPrecision: "highp",
        preferredFragmentPrecision: "highp"
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: wgsl, entryPoint: "mainVertex" },
        fragment: { source: wgsl, entryPoint: "mainFragment" }
      }),
      resources: { tubeLightingUniforms: lightingUniforms }
    });
    this.lightingUniforms = lightingUniforms;
    this.segments = segments;
    this.colors = colors;
    this.data = data;
    this.ambient = ambient;
    this.padding = 0;
  }

  setLighting(lights: readonly TubeLightSettings[], ambientColor: number, ambientStrength: number): void {
    const { segments, colors, data, ambient } = this;
    segments.fill(0);
    colors.fill(0);
    data.fill(0);
    lights.slice(0, MAX_LIGHTS).forEach((light, index) => {
      const axisX = Math.cos(light.angle);
      const axisY = Math.sin(light.angle);
      const half = light.length / 2;
      const offset = index * 4;
      segments[offset] = light.x - axisX * half;
      segments[offset + 1] = light.y - axisY * half;
      segments[offset + 2] = light.x + axisX * half;
      segments[offset + 3] = light.y + axisY * half;
      colors[offset] = ((light.color >> 16) & 0xff) / 255;
      colors[offset + 1] = ((light.color >> 8) & 0xff) / 255;
      colors[offset + 2] = (light.color & 0xff) / 255;
      colors[offset + 3] = light.intensity;
      data[offset] = -Math.sin(light.angle);
      data[offset + 1] = Math.cos(light.angle);
      data[offset + 2] = light.reach;
      data[offset + 3] = light.coneAngle ?? 0;
    });
    this.lightingUniforms.uniforms.uLightCount = Math.min(lights.length, MAX_LIGHTS);
    ambient[0] = ((ambientColor >> 16) & 0xff) / 255;
    ambient[1] = ((ambientColor >> 8) & 0xff) / 255;
    ambient[2] = (ambientColor & 0xff) / 255;
    ambient[3] = ambientStrength;
    this.lightingUniforms.update();
  }
}
