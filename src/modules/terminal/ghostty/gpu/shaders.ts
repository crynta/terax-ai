const SCREEN = /* wgsl */ `
struct Screen {
  size: vec2f,
  cursor_origin: vec2f,
  cursor_size: vec2f,
  text_blink_visible: f32,
  padding: f32,
  cursor_color: vec4f,
  decoration: vec4f,
}

@group(0) @binding(0) var<uniform> screen: Screen;
`;

export const COLOR_SHADER = /* wgsl */ `
${SCREEN}

struct VertexInput {
  @builtin(vertex_index) vertex_index: u32,
  @location(0) origin: vec2f,
  @location(1) size: vec2f,
  @location(2) background: vec4f,
  @location(3) underline_color: vec4f,
  @location(4) foreground: vec4f,
  @location(5) flags: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) pixel: vec2f,
  @location(1) local: vec2f,
  @location(2) size: vec2f,
  @location(3) background: vec4f,
  @location(4) underline_color: vec4f,
  @location(5) foreground: vec4f,
  @interpolate(flat) @location(6) flags: u32,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let corner = corners[input.vertex_index];
  let local = corner * input.size;
  let pixel = input.origin + local;
  let clip = vec2f(
    pixel.x / screen.size.x * 2.0 - 1.0,
    1.0 - pixel.y / screen.size.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.pixel = pixel;
  output.local = local;
  output.size = input.size;
  output.background = input.background;
  output.underline_color = input.underline_color;
  output.foreground = input.foreground;
  output.flags = input.flags;
  return output;
}

fn decoration_color(input: VertexOutput) -> vec4f {
  let underline_style = input.flags & 7u;
  let strike = (input.flags & 8u) != 0u;
  let overline = (input.flags & 16u) != 0u;
  let baseline = screen.decoration.x;
  let scale = screen.decoration.y;
  let strike_y = screen.decoration.z;

  if (overline && input.local.y >= scale && input.local.y < 2.0 * scale) {
    return input.foreground;
  }
  if (strike && input.local.y >= strike_y && input.local.y < strike_y + scale) {
    return input.foreground;
  }
  if (underline_style == 0u) { return input.background; }

  if (underline_style == 1u) {
    let y = baseline + 2.0 * scale;
    if (input.local.y >= y && input.local.y < y + scale) {
      return input.underline_color;
    }
    return input.background;
  }

  let top = baseline;
  let height = 3.0 * scale;
  if (input.local.y < top || input.local.y >= top + height) {
    return input.background;
  }
  let unit_y = (input.local.y - top) / height;
  let unit_x = input.local.x / max(input.size.x, 1.0);
  if (underline_style == 2u && unit_y > 0.28 && unit_y < 0.72) {
    return input.background;
  }
  if (underline_style == 3u) {
    let wave = 0.5 + sin(unit_x * 12.5663706) * 0.27;
    if (abs(unit_y - wave) > 0.18) { return input.background; }
  }
  if (underline_style == 4u && fract(unit_x * 4.0) > 0.42) {
    return input.background;
  }
  if (underline_style == 5u && fract(unit_x * 2.0) > 0.68) {
    return input.background;
  }
  return input.underline_color;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let cursor_end = screen.cursor_origin + screen.cursor_size;
  let in_cursor =
    input.pixel.x >= screen.cursor_origin.x &&
    input.pixel.y >= screen.cursor_origin.y &&
    input.pixel.x < cursor_end.x &&
    input.pixel.y < cursor_end.y;
  if (in_cursor) { return screen.cursor_color; }
  return decoration_color(input);
}
`;

export const GLYPH_SHADER = /* wgsl */ `
${SCREEN}

@group(0) @binding(1) var coverage_texture: texture_2d<f32>;
@group(0) @binding(2) var color_texture: texture_2d<f32>;
@group(0) @binding(3) var glyph_sampler: sampler;

struct VertexInput {
  @builtin(vertex_index) vertex_index: u32,
  @location(0) origin: vec2f,
  @location(1) size: vec2f,
  @location(2) uv_min: vec2f,
  @location(3) uv_max: vec2f,
  @location(4) color: vec4f,
  @location(5) flags: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @interpolate(flat) @location(2) flags: u32,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let corner = corners[input.vertex_index];
  let pixel = input.origin + corner * input.size;
  let clip = vec2f(
    pixel.x / screen.size.x * 2.0 - 1.0,
    1.0 - pixel.y / screen.size.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.uv = mix(input.uv_min, input.uv_max, corner);
  output.color = input.color;
  output.flags = input.flags;
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let intrinsic_color = (input.flags & 1u) != 0u;
  let blinking = (input.flags & 2u) != 0u;
  let coverage_in_red = (input.flags & 4u) != 0u;
  let visible = !blinking || screen.text_blink_visible > 0.5;
  if (!visible) { return vec4f(0.0); }
  if (intrinsic_color) {
    let color = textureSample(color_texture, glyph_sampler, input.uv);
    return vec4f(color.rgb, color.a * input.color.a);
  }
  let coverage_sample = textureSample(coverage_texture, glyph_sampler, input.uv);
  let coverage = select(coverage_sample.a, coverage_sample.r, coverage_in_red);
  return vec4f(input.color.rgb, input.color.a * coverage);
}
`;
