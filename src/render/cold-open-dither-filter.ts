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
uniform float uProgress;

float ditherThreshold(vec2 position)
{
    vec2 cell = mod(floor(position / 8.0), 4.0);
    float x = cell.x;
    float y = cell.y;
    float rank;

    if (y < 1.0) {
        rank = x < 1.0 ? 0.0 : (x < 2.0 ? 8.0 : (x < 3.0 ? 2.0 : 10.0));
    } else if (y < 2.0) {
        rank = x < 1.0 ? 12.0 : (x < 2.0 ? 4.0 : (x < 3.0 ? 14.0 : 6.0));
    } else if (y < 3.0) {
        rank = x < 1.0 ? 3.0 : (x < 2.0 ? 11.0 : (x < 3.0 ? 1.0 : 9.0));
    } else {
        rank = x < 1.0 ? 15.0 : (x < 2.0 ? 7.0 : (x < 3.0 ? 13.0 : 5.0));
    }

    return (rank + 0.5) / 16.0;
}

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    float revealed = step(ditherThreshold(gl_FragCoord.xy), uProgress);
    finalColor = vec4(color.rgb * revealed, color.a);
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

struct ColdOpenDitherUniforms {
    uProgress: f32,
    _padding: vec3<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> ditherUniforms: ColdOpenDitherUniforms;

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

fn ditherThreshold(position: vec2<f32>) -> f32 {
    let gridCell = floor(position / 8.0);
    let cell = gridCell - floor(gridCell / 4.0) * 4.0;
    let x = cell.x;
    let y = cell.y;
    var rank: f32;

    if (y < 1.0) {
      rank = select(select(10.0, 2.0, x < 3.0), select(8.0, 0.0, x < 1.0), x < 2.0);
    } else if (y < 2.0) {
      rank = select(select(6.0, 14.0, x < 3.0), select(4.0, 12.0, x < 1.0), x < 2.0);
    } else if (y < 3.0) {
      rank = select(select(9.0, 1.0, x < 3.0), select(11.0, 3.0, x < 1.0), x < 2.0);
    } else {
      rank = select(select(5.0, 13.0, x < 3.0), select(7.0, 15.0, x < 1.0), x < 2.0);
    }

    return (rank + 0.5) / 16.0;
}

@fragment
fn mainFragment(input: VSOutput) -> @location(0) vec4<f32> {
    let color = textureSample(uTexture, uSampler, input.uv);
    let revealed = step(ditherThreshold(input.position.xy), ditherUniforms.uProgress);
    return vec4(color.rgb * revealed, color.a);
}
`;

export class ColdOpenDitherFilter extends Filter {
  private readonly ditherUniforms: UniformGroup;

  constructor() {
    const ditherUniforms = new UniformGroup({
      uProgress: { value: 0, type: "f32" },
      _padding: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" }
    });
    super({
      glProgram: GlProgram.from({
        vertex,
        fragment,
        name: "groundtruth-cold-open-dither",
        preferredVertexPrecision: "highp",
        preferredFragmentPrecision: "highp"
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: wgsl, entryPoint: "mainVertex" },
        fragment: { source: wgsl, entryPoint: "mainFragment" }
      }),
      resources: { coldOpenDitherUniforms: ditherUniforms }
    });
    this.ditherUniforms = ditherUniforms;
    this.padding = 0;
  }

  setProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    const stepped = Math.min(1, (Math.floor(clamped * 4) + 1) / 4);
    this.ditherUniforms.uniforms.uProgress = stepped;
    this.ditherUniforms.update();
  }
}
