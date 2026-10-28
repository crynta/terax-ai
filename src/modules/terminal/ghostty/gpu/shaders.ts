/*
 * Terminal renderer v2 shaders. Cells are 16-byte records read from a storage
 * buffer (see `packages/ghostty-core/lib/adapted/gpuCells.ts`):
 *   word0 bits 0..23 glyph id, 24..26 underline style, 27 strike, 28 overline,
 *         29 blink, 30 wide lead
 *   word1 foreground RGBA8, word2 background RGBA8, word3 underline RGBA8
 * All coordinates are integer device pixels; nothing is filtered.
 */

export const SCREEN_UNIFORM_BYTES = 192;

/** Byte offsets of `Screen` fields; the TypeScript packer mirrors this layout. */
export const SCREEN_OFFSET = {
  /** Device-pixel size of the pane's viewport in the shared window canvas. */
  viewportSize: 0,
  cellSize: 8,
  dims: 16,
  flags: 24,
  /** Device pixels the grid is shifted up inside the viewport (a pane shorter than its grid). */
  shiftY: 28,
  cursorOrigin: 32,
  cursorSize: 40,
  cursorColor: 48,
  themeBackground: 64,
  selectionColor: 80,
  selectionLines: 96,
  selectionColumns: 112,
  /**
   * Device-pixel origin of the pane (signed: a pane laid out partly left of or above the canvas
   * starts before its viewport); fragment coordinates are window-relative.
   */
  origin: 120,
  /** Device pixels of the pane cut off at the canvas's left and top edge (viewport starts there). */
  clip: 128,
  decoration: 144,
  contrast: 160,
  gamma: 176,
} as const;

export const SCREEN_FLAG_TEXT_BLINK_VISIBLE = 1;
export const SCREEN_FLAG_SEARCH_ACTIVE = 2;
export const SCREEN_FLAG_SELECTION_ACTIVE = 4;
export const SCREEN_FLAG_SELECTION_RECTANGULAR = 8;

/*
 * Notes on the shader source below (kept out of the WGSL strings: they ship in the bundle):
 * - `cell_background` is the displayed background of a cell after search and selection. The
 *   trailing half of a wide character takes both from its lead, as the previous renderer
 *   treated the pair as one span.
 * - Fragment coordinates are relative to the window canvas, not to the pane's viewport.
 * - A glyph that overhangs to the left is clipped where the neighbour's background differs,
 *   so it cannot paint over a selection or a coloured cell.
 * - Cell-exact shapes (box drawing, shades) keep their coverage as drawn, without contrast.
 */
const COMMON = /* wgsl */ `
struct Screen {
  viewport_size: vec2f,
  cell_size: vec2u,
  dims: vec2u,
  flags: u32,
  shift_y: u32,
  cursor_origin: vec2f,
  cursor_size: vec2f,
  cursor_color: vec4f,
  theme_background: vec4f,
  selection_color: vec4f,
  selection_lines: vec4i,
  selection_columns: vec2i,
  origin: vec2i,
  clip: vec2u,
  decoration: vec4u,
  contrast: vec4f,
  gamma: vec4f,
}

@group(0) @binding(0) var<uniform> screen: Screen;
@group(0) @binding(1) var<storage, read> cells: array<vec4u>;
@group(0) @binding(2) var<storage, read> glyph_map: array<u32>;
@group(0) @binding(3) var<storage, read> glyph_table: array<vec4u>;
@group(0) @binding(4) var<storage, read> search_mask: array<u32>;
@group(0) @binding(5) var coverage_texture: texture_2d<f32>;
@group(0) @binding(6) var color_texture: texture_2d<f32>;

const FLAG_TEXT_BLINK_VISIBLE = 1u;
const FLAG_SEARCH_ACTIVE = 2u;
const FLAG_SELECTION_ACTIVE = 4u;
const FLAG_SELECTION_RECTANGULAR = 8u;

const SEARCH_MATCH = vec3f(0.31764706, 0.36078432, 0.41568628);
const SEARCH_ACTIVE_MATCH = vec3f(0.81960785, 0.52549022, 0.08627451);

const GLYPH_UNMAPPED = 0xfffffffeu;

fn attrs_of(record: vec4u) -> u32 {
  return record.x >> 24u;
}

fn is_wide_lead(record: vec4u) -> bool {
  return ((record.x >> 30u) & 1u) != 0u;
}

fn is_spacer_tail(index: u32, col: u32) -> bool {
  return col > 0u && is_wide_lead(cells[index - 1u]);
}

fn selection_contains(row: i32, col: i32) -> bool {
  if ((screen.flags & FLAG_SELECTION_ACTIVE) == 0u) { return false; }
  let start_line = screen.selection_lines.x;
  let start_col = screen.selection_lines.y;
  let end_line = screen.selection_lines.z;
  let end_col = screen.selection_lines.w;
  if (row < start_line || row > end_line) { return false; }
  if ((screen.flags & FLAG_SELECTION_RECTANGULAR) != 0u) {
    return col >= screen.selection_columns.x && col <= screen.selection_columns.y;
  }
  if (start_line == end_line) { return col >= start_col && col <= end_col; }
  if (row == start_line) { return col >= start_col; }
  if (row == end_line) { return col <= end_col; }
  return true;
}

fn search_state(cell_index: u32) -> u32 {
  if ((screen.flags & FLAG_SEARCH_ACTIVE) == 0u) { return 0u; }
  let word = search_mask[cell_index >> 2u];
  return (word >> ((cell_index & 3u) * 8u)) & 3u;
}

fn cell_background(index: u32, row: u32, col: u32) -> vec3f {
  var lead_col = col;
  if (is_spacer_tail(index, col)) { lead_col = col - 1u; }
  var background = unpack4x8unorm(cells[index].z).rgb;
  let match_state = search_state(row * screen.dims.x + lead_col);
  if (match_state == 1u) { background = SEARCH_MATCH; }
  if (match_state == 2u) { background = SEARCH_ACTIVE_MATCH; }
  if (selection_contains(i32(row), i32(lead_col))) {
    background = mix(background, screen.selection_color.rgb, screen.selection_color.a);
  }
  return background;
}
`;

export const BACKGROUND_SHADER = /* wgsl */ `
${COMMON}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertex_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(corners[vertex_index], 0.0, 1.0);
  return output;
}

fn decoration_color(
  record: vec4u,
  background: vec3f,
  local: vec2u,
  span_width: u32,
) -> vec3f {
  let attrs = attrs_of(record);
  let underline_style = attrs & 7u;
  let strike = (attrs & 8u) != 0u;
  let overline = (attrs & 16u) != 0u;
  let foreground = unpack4x8unorm(record.y).rgb;
  let underline_color = unpack4x8unorm(record.w).rgb;
  let baseline = screen.decoration.x;
  let thickness = screen.decoration.y;
  let strike_y = screen.decoration.z;
  let y = local.y;

  if (overline && y >= thickness && y < 2u * thickness) { return foreground; }
  if (strike && y >= strike_y && y < strike_y + thickness) { return foreground; }
  if (underline_style == 0u) { return background; }

  if (underline_style == 1u) {
    let line_top = baseline + 2u * thickness;
    if (y >= line_top && y < line_top + thickness) { return underline_color; }
    return background;
  }

  let band_top = baseline;
  let height = 3u * thickness;
  if (y < band_top || y >= band_top + height) { return background; }
  let unit_y = (f32(y - band_top) + 0.5) / f32(height);
  let unit_x = (f32(local.x) + 0.5) / f32(max(span_width, 1u));
  if (underline_style == 2u && unit_y > 0.28 && unit_y < 0.72) { return background; }
  if (underline_style == 3u) {
    let wave = 0.5 + sin(unit_x * 12.5663706) * 0.27;
    if (abs(unit_y - wave) > 0.18) { return background; }
  }
  if (underline_style == 4u && fract(unit_x * 4.0) > 0.42) { return background; }
  if (underline_style == 5u && fract(unit_x * 2.0) > 0.68) { return background; }
  return underline_color;
}

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let local_position = position.xy - vec2f(screen.origin) + vec2f(0.0, f32(screen.shift_y));
  let pixel = vec2u(local_position);
  let cell = pixel / screen.cell_size;
  if (cell.x >= screen.dims.x || cell.y >= screen.dims.y) {
    return vec4f(screen.theme_background.rgb, 1.0);
  }
  let index = cell.y * screen.dims.x + cell.x;
  let record = cells[index];
  let background = cell_background(index, cell.y, cell.x);

  let cursor_end = screen.cursor_origin + screen.cursor_size;
  if (local_position.x >= screen.cursor_origin.x && local_position.y >= screen.cursor_origin.y &&
      local_position.x < cursor_end.x && local_position.y < cursor_end.y) {
    return vec4f(screen.cursor_color.rgb, 1.0);
  }

  var local = pixel - cell * screen.cell_size;
  var span_width = screen.cell_size.x;
  if (is_wide_lead(record)) {
    span_width = 2u * screen.cell_size.x;
  } else if (is_spacer_tail(index, cell.x)) {
    local.x = local.x + screen.cell_size.x;
    span_width = 2u * screen.cell_size.x;
  }
  return vec4f(decoration_color(record, background, local, span_width), 1.0);
}
`;

export const GLYPH_SHADER = /* wgsl */ `
${COMMON}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @interpolate(flat) @location(0) texel_origin: vec2i,
  @interpolate(flat) @location(1) quad_origin: vec2i,
  @interpolate(flat) @location(2) color: vec4f,
  @interpolate(flat) @location(3) glyph_flags: u32,
}

fn degenerate() -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(2.0, 2.0, 2.0, 1.0);
  output.texel_origin = vec2i(0);
  output.quad_origin = vec2i(0);
  output.color = vec4f(0.0);
  output.glyph_flags = 0u;
  return output;
}

fn low_signed(word: u32) -> i32 {
  return bitcast<i32>(word << 16u) >> 16u;
}

fn high_signed(word: u32) -> i32 {
  return bitcast<i32>(word) >> 16u;
}

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance: u32,
) -> VertexOutput {
  let record = cells[instance];
  let glyph_id = record.x & 0xffffffu;
  if (glyph_id == 0u || glyph_id >= arrayLength(&glyph_map)) { return degenerate(); }
  let blinking = ((record.x >> 29u) & 1u) != 0u;
  if (blinking && (screen.flags & FLAG_TEXT_BLINK_VISIBLE) == 0u) { return degenerate(); }
  let table_index = glyph_map[glyph_id];
  if (table_index >= GLYPH_UNMAPPED || table_index >= arrayLength(&glyph_table)) {
    return degenerate();
  }
  let entry = glyph_table[table_index];
  let size = vec2i(i32(entry.y & 0xffffu), i32(entry.y >> 16u));
  if (size.x == 0 || size.y == 0) { return degenerate(); }

  let cols = screen.dims.x;
  let row = instance / cols;
  let col = instance - row * cols;
  let cell_origin = vec2i(i32(col * screen.cell_size.x), i32(row * screen.cell_size.y));
  var origin = cell_origin + vec2i(low_signed(entry.z), high_signed(entry.z));
  var drawn = size;
  var skipped = 0;

  let padding = i32(screen.decoration.w);
  let bearing_x = low_signed(entry.z);
  if (bearing_x < -padding) {
    var previous = screen.theme_background.rgb;
    if (col > 0u) { previous = cell_background(instance - 1u, row, col - 1u); }
    let current = cell_background(instance, row, col);
    if (any(previous != current)) {
      skipped = min(size.x, -padding - bearing_x);
      origin.x = origin.x + skipped;
      drawn.x = drawn.x - skipped;
    }
  }
  if (drawn.x <= 0) { return degenerate(); }

  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertex_index];
  let pixel = vec2f(origin) + corner * vec2f(drawn) - vec2f(0.0, f32(screen.shift_y)) -
    vec2f(screen.clip);
  var output: VertexOutput;
  output.position = vec4f(
    pixel.x / screen.viewport_size.x * 2.0 - 1.0,
    1.0 - pixel.y / screen.viewport_size.y * 2.0,
    0.0,
    1.0,
  );
  output.texel_origin = vec2i(i32(entry.x & 0xffffu) + skipped, i32(entry.x >> 16u));
  output.quad_origin = origin;
  output.color = unpack4x8unorm(record.y);
  output.glyph_flags = entry.w;
  return output;
}

fn apply_contrast(coverage: f32, foreground: vec3f) -> f32 {
  let enhanced_contrast = screen.contrast.x;
  let correction = screen.contrast.y;
  if (enhanced_contrast <= 0.0 && correction <= 0.0) { return coverage; }
  let lightness = dot(foreground, vec3f(0.30, 0.59, 0.11));
  let k = enhanced_contrast * saturate(4.0 * (0.75 - lightness));
  let enhanced = coverage * (k + 1.0) / (coverage * k + 1.0);
  let intensity = dot(foreground, vec3f(0.25, 0.5, 0.25));
  let g = screen.gamma;
  let corrected = enhanced + enhanced * (1.0 - enhanced) *
    ((g.x * intensity + g.y) * enhanced + (g.z * intensity + g.w));
  return saturate(mix(enhanced, corrected, correction));
}

@fragment
fn fragment_main(
  @builtin(position) position: vec4f,
  @interpolate(flat) @location(0) texel_origin: vec2i,
  @interpolate(flat) @location(1) quad_origin: vec2i,
  @interpolate(flat) @location(2) color: vec4f,
  @interpolate(flat) @location(3) glyph_flags: u32,
) -> @location(0) vec4f {
  let texel = texel_origin + vec2i(floor(position.xy)) - vec2i(screen.origin) +
    vec2i(0, i32(screen.shift_y)) - quad_origin;
  if ((glyph_flags & 1u) != 0u) {
    let sample = textureLoad(color_texture, texel, 0);
    return vec4f(sample.rgb, sample.a * color.a);
  }
  let coverage = textureLoad(coverage_texture, texel, 0).r;
  if ((glyph_flags & 2u) != 0u) { return vec4f(color.rgb, color.a * coverage); }
  return vec4f(color.rgb, color.a * apply_contrast(coverage, color.rgb));
}
`;
