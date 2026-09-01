import { Filter, GlProgram, GpuProgram, UniformGroup } from "pixi.js";

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec2 uPixelSize;

void main(void)
{
    vec2 inputPixels = max(uInputSize.xy, vec2(1.0));
    vec2 pixelSize = max(uPixelSize, vec2(1.0));
    vec2 pixelCoord = floor(vTextureCoord * inputPixels / pixelSize) + 0.5;
    vec2 snappedUv = clamp(pixelCoord * pixelSize / inputPixels, uInputClamp.xy, uInputClamp.zw);
    finalColor = texture(uTexture, snappedUv);
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

struct SparkPixelUniforms {
    uPixelSize: vec2<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> sparkPixelUniforms: SparkPixelUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    let uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
    return VSOutput(vec4(position, 0.0, 1.0), uv);
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let inputPixels = max(gfu.uInputSize.xy, vec2(1.0));
    let pixelSize = max(sparkPixelUniforms.uPixelSize, vec2(1.0));
    let pixelCoord = floor(uv * inputPixels / pixelSize) + vec2(0.5);
    let snappedUv = clamp(pixelCoord * pixelSize / inputPixels, gfu.uInputClamp.xy, gfu.uInputClamp.zw);
    return textureSample(uTexture, uSampler, snappedUv);
}
`;

export class SparkPixelateFilter extends Filter {
  constructor(pixelSize = 2) {
    const uniforms = new UniformGroup({
      uPixelSize: { value: new Float32Array([pixelSize, pixelSize]), type: "vec2<f32>" }
    });
    super({
      glProgram: GlProgram.from({
        vertex,
        fragment,
        name: "groundtruth-spark-pixelate",
        preferredVertexPrecision: "highp",
        preferredFragmentPrecision: "highp"
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: wgsl, entryPoint: "mainVertex" },
        fragment: { source: wgsl, entryPoint: "mainFragment" }
      }),
      resources: { sparkPixelUniforms: uniforms }
    });
    this.padding = 0;
  }
}
