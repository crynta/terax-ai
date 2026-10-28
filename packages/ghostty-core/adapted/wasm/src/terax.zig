const std = @import("std");
const ghostty = @import("ghostty-vt");
const terminfo_responses = @import("ghostty-terminfo-responses");

pub const std_options: std.Options = ghostty.std_options;

const Allocator = std.mem.Allocator;

const ErrorCode = enum(u32) {
    ok = 0,
    invalid_handle = 1,
    out_of_memory = 2,
    invalid_arg = 3,
    internal = 4,
};

const CellFlags = struct {
    const hyperlink: u16 = 1 << 0;
    const has_grapheme: u16 = 1 << 1;
    const protected: u16 = 1 << 2;
};

const TerminalEvent = enum(u8) {
    bell = 1,
    title = 2,
    pwd = 3,
    clipboard = 4,
    notification = 5,
    prompt_start = 6,
    prompt_continuation = 7,
    prompt_end = 8,
    end_of_input = 9,
    end_of_command = 10,
    screen_cleared = 11,
};

const CursorInfo = extern struct {
    row: u16,
    col: u16,
    visible: u8,
    style: u8,
    blinking: u8,
    wide_tail: u8,
    color_rgba: u32,
    reserved: u32 = 0,
};

const SearchViewportSpan = extern struct {
    row: u16,
    start_col: u16,
    end_col: u16,
    selected: u8,
    reserved: u8 = 0,
};

const SearchStatus = extern struct {
    active: u8,
    pending: u8,
    complete: u8,
    reserved: u8 = 0,
    generation: u32,
    total_matches: u32,
    selected_index: i32,
};

const cell_buffer_alignment: usize = 256;
const row_buffer_alignment: usize = 16;

/// Selects which per-cell representation `restty_render_update` writes.
///
/// - `soa`: eleven structure-of-arrays cell buffers (codepoint, style, colors,
///   grapheme offsets, ...). Used by the WebGL fallback and legacy consumers.
/// - `gpu`: one packed 16-byte record per cell that a GPU shader can consume
///   directly (see `GpuCell`), plus interned glyph ids. No SoA cell arrays.
///
/// Both formats keep hyperlink ids per cell and the per-row arrays.
const RenderFormat = enum(u8) { soa = 0, gpu = 1 };

fn nextBufferCapacity(current: usize, required: usize, alignment: usize) usize {
    if (required <= current) return current;
    const headroom = if (current == 0)
        @max(1, (required + 7) / 8)
    else
        @max(1, (current + 3) / 4);
    const target = if (current == 0)
        required + headroom
    else
        @max(required, current + headroom);
    return ((target + alignment - 1) / alignment) * alignment;
}

/// Bump carver over the single cell-buffer arena. With an empty byte slice it
/// only measures, which keeps the sizing pass and the carving pass identical.
const ArenaCarver = struct {
    bytes: []u8,
    offset: usize = 0,

    fn take(self: *ArenaCarver, comptime T: type, len: usize) []T {
        self.offset = std.mem.alignForward(usize, self.offset, @alignOf(T));
        const start = self.offset;
        self.offset += @sizeOf(T) * len;
        if (self.bytes.len == 0) return &.{};
        const ptr: [*]T = @ptrCast(@alignCast(self.bytes.ptr + start));
        return ptr[0..len];
    }
};

const CellBuffers = struct {
    storage: []u64 = &.{},
    format: RenderFormat = .soa,
    cell_capacity: usize = 0,
    row_capacity: usize = 0,

    // SoA format only; empty slices in the GPU format.
    codepoints: []u32 = &.{},
    content_tags: []u8 = &.{},
    wide: []u8 = &.{},
    flags: []u16 = &.{},
    style_flags: []u16 = &.{},
    underline_styles: []u8 = &.{},
    fg_rgba: []u32 = &.{},
    bg_rgba: []u32 = &.{},
    ul_rgba: []u32 = &.{},
    grapheme_offsets: []u32 = &.{},
    grapheme_lengths: []u32 = &.{},

    // GPU format only: four u32 words (`GpuCell`) per cell.
    records: []u32 = &.{},
    // GPU format only: visible blinking glyph cells per row.
    row_blink: []u16 = &.{},

    // Both formats.
    link_ids: []u32 = &.{},
    row_selection_start: []i16 = &.{},
    row_selection_end: []i16 = &.{},
    row_wrapped: []u8 = &.{},
    row_dirty: []u8 = &.{},

    const empty: CellBuffers = .{};

    fn ensureCapacity(
        self: *CellBuffers,
        alloc: Allocator,
        format: RenderFormat,
        rows: u16,
        cols: u16,
    ) !bool {
        const required_cells: usize = @as(usize, rows) * @as(usize, cols);
        const required_rows: usize = rows;
        const same_format = self.format == format;
        if (same_format and
            required_cells <= self.cell_capacity and
            required_rows <= self.row_capacity)
        {
            return false;
        }

        const cell_capacity = nextBufferCapacity(
            if (same_format) self.cell_capacity else 0,
            required_cells,
            cell_buffer_alignment,
        );
        const row_capacity = nextBufferCapacity(
            if (same_format) self.row_capacity else 0,
            required_rows,
            row_buffer_alignment,
        );
        const storage = try alloc.realloc(
            self.storage,
            storageWordCount(format, cell_capacity, row_capacity),
        );
        self.* = fromStorage(storage, format, cell_capacity, row_capacity);
        @memset(self.row_dirty, 1);
        @memset(self.row_blink, 0);
        return true;
    }

    fn compactCapacity(self: *CellBuffers, alloc: Allocator, rows: u16, cols: u16) !bool {
        const format = self.format;
        const cell_capacity = nextBufferCapacity(
            0,
            @as(usize, rows) * @as(usize, cols),
            cell_buffer_alignment,
        );
        const row_capacity = nextBufferCapacity(0, rows, row_buffer_alignment);
        const target_words = storageWordCount(format, cell_capacity, row_capacity);
        if (target_words >= self.storage.len or target_words * 3 > self.storage.len * 2) {
            return false;
        }

        const storage = try alloc.realloc(self.storage, target_words);
        self.* = fromStorage(storage, format, cell_capacity, row_capacity);
        @memset(self.row_dirty, 1);
        @memset(self.row_blink, 0);
        return true;
    }

    pub fn deinit(self: *CellBuffers, alloc: Allocator) void {
        alloc.free(self.storage);
    }

    fn storageWordCount(format: RenderFormat, cell_capacity: usize, row_capacity: usize) usize {
        const sized = carve(&.{}, format, cell_capacity, row_capacity);
        return (sized.end + @sizeOf(u64) - 1) / @sizeOf(u64);
    }

    fn fromStorage(
        storage: []u64,
        format: RenderFormat,
        cell_capacity: usize,
        row_capacity: usize,
    ) CellBuffers {
        var result = carve(
            std.mem.sliceAsBytes(storage),
            format,
            cell_capacity,
            row_capacity,
        ).buffers;
        result.storage = storage;
        return result;
    }

    /// The only place the arena layout is defined. Slice order is stable per
    /// format, so a resize within capacity never moves a pointer.
    fn carve(
        bytes: []u8,
        format: RenderFormat,
        cell_capacity: usize,
        row_capacity: usize,
    ) struct { buffers: CellBuffers, end: usize } {
        var arena: ArenaCarver = .{ .bytes = bytes };
        var result: CellBuffers = .{
            .format = format,
            .cell_capacity = cell_capacity,
            .row_capacity = row_capacity,
        };
        switch (format) {
            .soa => {
                result.codepoints = arena.take(u32, cell_capacity);
                result.content_tags = arena.take(u8, cell_capacity);
                result.wide = arena.take(u8, cell_capacity);
                result.flags = arena.take(u16, cell_capacity);
                result.style_flags = arena.take(u16, cell_capacity);
                result.underline_styles = arena.take(u8, cell_capacity);
                result.link_ids = arena.take(u32, cell_capacity);
                result.fg_rgba = arena.take(u32, cell_capacity);
                result.bg_rgba = arena.take(u32, cell_capacity);
                result.ul_rgba = arena.take(u32, cell_capacity);
                result.grapheme_offsets = arena.take(u32, cell_capacity);
                result.grapheme_lengths = arena.take(u32, cell_capacity);
            },
            .gpu => {
                // Must stay first: the arena base is 8-byte aligned, so every
                // 16-byte record is too (`storeRecord` relies on it) and each
                // row offset is a multiple of 16 for `queue.writeBuffer`.
                result.records = arena.take(u32, cell_capacity * gpu_cell_words);
                result.link_ids = arena.take(u32, cell_capacity);
            },
        }
        result.row_selection_start = arena.take(i16, row_capacity);
        result.row_selection_end = arena.take(i16, row_capacity);
        result.row_wrapped = arena.take(u8, row_capacity);
        result.row_dirty = arena.take(u8, row_capacity);
        if (format == .gpu) result.row_blink = arena.take(u16, row_capacity);
        return .{ .buffers = result, .end = arena.offset };
    }
};

const CursorVisualStyle = @TypeOf(ghostty.RenderState.empty.cursor.visual_style);
const StreamAction = ghostty.StreamAction;
const VtHandlerFn = @TypeOf(ghostty.Terminal.vtHandler);
const ReadonlyHandler = @typeInfo(VtHandlerFn).@"fn".return_type.?;
const kitty_graphics_enabled = @hasDecl(ghostty.kitty.graphics, "Command");
const max_output_bytes: usize = 256 * 1024;
const max_retained_output_bytes: usize = 16 * 1024;
const max_key_output_bytes: usize = 256;
const max_event_payload_bytes: usize = 256 * 1024;
const max_event_buffer_bytes: usize = max_event_payload_bytes + 64 * 1024;
const max_apc_debug_bytes: usize = 16 * 1024;
const max_apc_error_logs: u8 = 24;
const max_retained_grapheme_codepoints: usize = 64 * 1024;
const max_retained_link_bytes: usize = 64 * 1024;
const max_retained_link_count: usize = 4 * 1024;
const render_state_reset_interval: u32 = 100_000;

const log = std.log.scoped(.restty_apc);

const KittyPlacementAbi = extern struct {
    image_id: u32,
    image_format: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },
    image_width: u32,
    image_height: u32,
    image_data_ptr: u32,
    image_data_len: u32,
    x: i32,
    y: i32,
    z: i32,
    width: u32,
    height: u32,
    cell_offset_x: u32,
    cell_offset_y: u32,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
    placement_id: u32,
    placement_external: u8,
    _pad1: [3]u8 = .{ 0, 0, 0 },
};

const StreamHandler = struct {
    alloc: Allocator,
    term: *ghostty.Terminal,
    readonly: ReadonlyHandler,
    output: *std.ArrayListUnmanaged(u8),
    events: *std.ArrayListUnmanaged(u8),
    dropped_events: *u32,
    semantic_markers: *SemanticMarkers,
    apc: ghostty.apc.Handler = .{},
    dcs: ghostty.dcs.Handler = .{},
    apc_debug: std.ArrayListUnmanaged(u8) = .empty,
    apc_debug_truncated: bool = false,
    apc_error_logs_remaining: u8 = max_apc_error_logs,

    pub fn init(
        alloc: Allocator,
        term: *ghostty.Terminal,
        output: *std.ArrayListUnmanaged(u8),
        events: *std.ArrayListUnmanaged(u8),
        dropped_events: *u32,
        semantic_markers: *SemanticMarkers,
    ) StreamHandler {
        return .{
            .alloc = alloc,
            .term = term,
            .readonly = .init(term),
            .output = output,
            .events = events,
            .dropped_events = dropped_events,
            .semantic_markers = semantic_markers,
            .apc = .{},
            .dcs = .{},
            .apc_debug = .empty,
            .apc_debug_truncated = false,
            .apc_error_logs_remaining = max_apc_error_logs,
        };
    }

    pub fn deinit(self: *StreamHandler) void {
        self.readonly.deinit();
        self.apc.deinit();
        self.dcs.deinit();
        self.apc_debug.deinit(self.alloc);
    }

    fn dcsHook(self: *StreamHandler, dcs: ghostty.DCS) !void {
        var cmd = self.dcs.hook(self.alloc, dcs) orelse return;
        defer cmd.deinit();
        try self.dcsCommand(&cmd);
    }

    fn dcsPut(self: *StreamHandler, byte: u8) !void {
        var cmd = self.dcs.put(byte) orelse return;
        defer cmd.deinit();
        try self.dcsCommand(&cmd);
    }

    fn dcsUnhook(self: *StreamHandler) !void {
        var cmd = self.dcs.unhook() orelse return;
        defer cmd.deinit();
        try self.dcsCommand(&cmd);
    }

    fn dcsCommand(self: *StreamHandler, cmd: *ghostty.dcs.Command) !void {
        switch (cmd.*) {
            .xtgettcap => |*gettcap| {
                const map = terminfo_responses.map;
                while (gettcap.next()) |key| {
                    const response = map.get(key) orelse continue;
                    try self.appendOutput(response);
                }
            },
            .decrqss => |request| {
                var response: [ghostty.dcs.Command.DECRQSS.max_response_bytes]u8 = undefined;
                try self.appendOutput(try request.encode(self.term, &response));
            },
            .tmux => {},
        }
    }

    fn apcDebugReset(self: *StreamHandler) void {
        self.apc_debug.clearRetainingCapacity();
        self.apc_debug_truncated = false;
    }

    fn apcDebugCapture(self: *StreamHandler, byte: u8) void {
        if (self.apc_debug_truncated) return;
        if (self.apc_debug.items.len >= max_apc_debug_bytes) {
            self.apc_debug_truncated = true;
            return;
        }
        self.apc_debug.append(self.alloc, byte) catch {
            self.apc_debug_truncated = true;
        };
    }

    fn isBase64Byte(byte: u8) bool {
        return (byte >= 'A' and byte <= 'Z') or
            (byte >= 'a' and byte <= 'z') or
            (byte >= '0' and byte <= '9') or
            byte == '+' or
            byte == '/' or
            byte == '=';
    }

    fn logApcFailure(self: *StreamHandler) void {
        if (self.apc_error_logs_remaining == 0) return;
        const raw = self.apc_debug.items;
        if (raw.len == 0) return;

        // Only inspect Kitty APC packets.
        if (raw[0] != 'G') return;

        self.apc_error_logs_remaining -|= 1;

        const kitty = raw[1..];
        const sep_opt = std.mem.indexOfScalar(u8, kitty, ';');
        if (sep_opt == null) {
            const preview_len = @min(kitty.len, 64);
            log.warn(
                "kitty APC parse failed before payload control={s} bytes={d} truncated={} preview_hex={x}",
                .{
                    kitty[0..preview_len],
                    kitty.len,
                    self.apc_debug_truncated,
                    kitty[0..preview_len],
                },
            );
            return;
        }

        const sep = sep_opt.?;
        const control = kitty[0..sep];
        const payload = kitty[sep + 1 ..];

        var invalid_idx: ?usize = null;
        var invalid_byte: u8 = 0;
        for (payload, 0..) |byte, idx| {
            if (!isBase64Byte(byte)) {
                invalid_idx = idx;
                invalid_byte = byte;
                break;
            }
        }

        if (invalid_idx) |idx| {
            const win_start = idx -| 12;
            const win_end = @min(payload.len, idx + 13);
            log.warn(
                "kitty APC invalid payload byte control={s} payload_len={d} invalid=0x{x:0>2} at={d} around_hex={x} truncated={}",
                .{
                    control,
                    payload.len,
                    invalid_byte,
                    idx,
                    payload[win_start..win_end],
                    self.apc_debug_truncated,
                },
            );
            return;
        }

        const preview_len = @min(payload.len, 64);
        log.warn(
            "kitty APC parse failed control={s} payload_len={d} payload_mod4={d} truncated={} payload_preview_hex={x}",
            .{
                control,
                payload.len,
                payload.len % 4,
                self.apc_debug_truncated,
                payload[0..preview_len],
            },
        );
    }

    fn logKittyResponseError(
        self: *StreamHandler,
        cmd: *const ghostty.kitty.graphics.Command,
        resp: ghostty.kitty.graphics.Response,
    ) void {
        const action: []const u8 = switch (cmd.control) {
            .query => "q",
            .transmit => "t",
            .transmit_and_display => "T",
            .display => "p",
            .delete => "d",
            .transmit_animation_frame => "f",
            .control_animation => "a",
            .compose_animation => "c",
        };

        log.warn(
            "kitty graphics command failed action={s} quiet={} resp={s} resp_i={d} resp_I={d} resp_p={d} data_len={d}",
            .{
                action,
                cmd.quiet,
                resp.message,
                resp.id,
                resp.image_number,
                resp.placement_id,
                cmd.data.len,
            },
        );

        if (cmd.transmission()) |t| {
            log.warn(
                "kitty tx fields i={d} I={d} p={d} format={} medium={} s={d} v={d} S={d} O={d} m={} compression={}",
                .{
                    t.image_id,
                    t.image_number,
                    t.placement_id,
                    t.format,
                    t.medium,
                    t.width,
                    t.height,
                    t.size,
                    t.offset,
                    t.more_chunks,
                    t.compression,
                },
            );
        }

        if (cmd.display()) |d| {
            log.warn(
                "kitty display fields i={d} I={d} p={d} x={d} y={d} w={d} h={d} X={d} Y={d} c={d} r={d} C={} U={} z={d}",
                .{
                    d.image_id,
                    d.image_number,
                    d.placement_id,
                    d.x,
                    d.y,
                    d.width,
                    d.height,
                    d.x_offset,
                    d.y_offset,
                    d.columns,
                    d.rows,
                    d.cursor_movement,
                    d.virtual_placement,
                    d.z,
                },
            );
        }

        if (self.apc_debug.items.len > 0) {
            const preview_len = @min(self.apc_debug.items.len, 96);
            log.warn(
                "kitty APC preview_hex={x} bytes={d} truncated={}",
                .{
                    self.apc_debug.items[0..preview_len],
                    self.apc_debug.items.len,
                    self.apc_debug_truncated,
                },
            );
        }
    }

    fn appendOutput(self: *StreamHandler, bytes: []const u8) !void {
        if (bytes.len == 0) return;

        if (bytes.len >= max_output_bytes) {
            self.output.clearRetainingCapacity();
            try self.output.appendSlice(self.alloc, bytes[bytes.len - max_output_bytes ..]);
            return;
        }

        if (self.output.items.len + bytes.len > max_output_bytes) {
            const drop = self.output.items.len + bytes.len - max_output_bytes;
            if (drop >= self.output.items.len) {
                self.output.clearRetainingCapacity();
            } else {
                const remaining = self.output.items.len - drop;
                std.mem.copyForwards(
                    u8,
                    self.output.items[0..remaining],
                    self.output.items[drop..],
                );
                self.output.items.len = remaining;
            }
        }

        try self.output.appendSlice(self.alloc, bytes);
    }

    fn emitEvent(
        self: *StreamHandler,
        event: TerminalEvent,
        chunks: []const []const u8,
    ) !void {
        var payload_len: usize = 0;
        for (chunks) |chunk| payload_len = std.math.add(usize, payload_len, chunk.len) catch {
            self.dropped_events.* +|= 1;
            return;
        };
        const record_len = std.math.add(usize, payload_len, 5) catch {
            self.dropped_events.* +|= 1;
            return;
        };
        if (payload_len > max_event_payload_bytes or
            record_len > max_event_buffer_bytes -| self.events.items.len)
        {
            self.dropped_events.* +|= 1;
            return;
        }

        var header: [5]u8 = undefined;
        header[0] = @intFromEnum(event);
        std.mem.writeInt(u32, header[1..5], @intCast(payload_len), .little);
        try self.events.appendSlice(self.alloc, &header);
        for (chunks) |chunk| try self.events.appendSlice(self.alloc, chunk);
    }

    fn deviceAttributes(
        self: *StreamHandler,
        req: ghostty.DeviceAttributeReq,
    ) !void {
        switch (req) {
            .primary => try self.appendOutput("\x1b[?62;22;52c"),
            .secondary => try self.appendOutput("\x1b[>1;10;0c"),
            else => {},
        }
    }

    /// Cursor position for CPR/DECXCPR, relative to the scrolling region when
    /// origin mode is set.
    fn cursorReportPos(self: *StreamHandler) struct { x: usize, y: usize } {
        return if (self.term.modes.get(.origin)) .{
            .x = self.term.screens.active.cursor.x -| self.term.scrolling_region.left,
            .y = self.term.screens.active.cursor.y -| self.term.scrolling_region.top,
        } else .{
            .x = self.term.screens.active.cursor.x,
            .y = self.term.screens.active.cursor.y,
        };
    }

    fn deviceStatusReport(
        self: *StreamHandler,
        req: ghostty.device_status.Request,
    ) !void {
        switch (req) {
            .operating_status => try self.appendOutput("\x1b[0n"),
            .cursor_position => {
                const pos = self.cursorReportPos();

                var buf: [64]u8 = undefined;
                const resp = try std.fmt.bufPrint(&buf, "\x1b[{};{}R", .{
                    pos.y + 1,
                    pos.x + 1,
                });
                try self.appendOutput(resp);
            },
            // DECXCPR: extended cursor position adds a page number, always 1.
            .cursor_position_extended => {
                const pos = self.cursorReportPos();

                var buf: [64]u8 = undefined;
                const resp = try std.fmt.bufPrint(&buf, "\x1b[?{};{};1R", .{
                    pos.y + 1,
                    pos.x + 1,
                });
                try self.appendOutput(resp);
            },
            .color_scheme => {
                var buf: [ghostty.device_status.max_color_scheme_report_encode_size]u8 = undefined;
                var writer: std.Io.Writer = .fixed(&buf);
                try ghostty.device_status.encodeColorSchemeReport(&writer, .dark);
                try self.appendOutput(writer.buffered());
            },
            .visibility => {
                var buf: [ghostty.device_status.max_visibility_report_encode_size]u8 = undefined;
                var writer: std.Io.Writer = .fixed(&buf);
                try ghostty.device_status.encodeVisibilityReport(&writer, .potentially_visible);
                try self.appendOutput(writer.buffered());
            },
        }
    }

    fn requestMode(self: *StreamHandler, mode: ghostty.Mode) !void {
        const report = self.term.modes.getReport(.fromMode(mode));
        try self.appendModeReport(report);
    }

    fn requestModeUnknown(self: *StreamHandler, mode: u16, ansi: bool) !void {
        const report = self.term.modes.getReport(.{
            .value = @truncate(mode),
            .ansi = ansi,
        });
        try self.appendModeReport(report);
    }

    fn appendModeReport(self: *StreamHandler, report: ghostty.modes.Report) !void {
        var buf: [64]u8 = undefined;
        var writer: std.Io.Writer = .fixed(&buf);
        try report.encode(&writer);
        try self.appendOutput(writer.buffered());
    }

    fn sizeReport(self: *StreamHandler, style: ghostty.SizeReportStyle) !void {
        if (style == .csi_21_t) {
            try self.appendOutput("\x1b]l\x1b\\");
            return;
        }

        const cols: u32 = @intCast(self.term.cols);
        const rows: u32 = @intCast(self.term.rows);
        const size: ghostty.size_report.Size = .{
            .rows = self.term.rows,
            .columns = self.term.cols,
            .cell_width = if (cols == 0) 1 else @max(1, self.term.width_px / cols),
            .cell_height = if (rows == 0) 1 else @max(1, self.term.height_px / rows),
        };
        var buf: [128]u8 = undefined;
        var writer: std.Io.Writer = .fixed(&buf);
        switch (style) {
            .csi_14_t => try ghostty.size_report.encode(&writer, .csi_14_t, size),
            .csi_16_t => try ghostty.size_report.encode(&writer, .csi_16_t, size),
            .csi_18_t => try ghostty.size_report.encode(&writer, .csi_18_t, size),
            .csi_19_t => try ghostty.size_report.encode(&writer, .csi_19_t, size),
            .csi_21_t => unreachable,
        }
        try self.appendOutput(writer.buffered());
    }

    fn reportXtversion(self: *StreamHandler) !void {
        try self.appendOutput("\x1bP>|ghostty 1.3.2-dev\x1b\\");
    }

    fn colorOperation(
        self: *StreamHandler,
        value: StreamAction.Value(.color_operation),
    ) !void {
        self.readonly.vt(.color_operation, value);

        var buf: [4096]u8 = undefined;
        var writer: std.Io.Writer = .fixed(&buf);
        var it = value.requests.constIterator(0);
        while (it.next()) |req| {
            const kind = switch (req.*) {
                .query => |kind| kind,
                else => continue,
            };
            const color = switch (kind) {
                .palette => |index| self.term.colors.palette.current[index],
                .dynamic => |dynamic| switch (dynamic) {
                    .foreground => self.term.colors.foreground.get().?,
                    .background => self.term.colors.background.get().?,
                    .cursor => self.term.colors.cursor.get() orelse self.term.colors.foreground.get().?,
                    else => continue,
                },
                .special => continue,
            };
            switch (kind) {
                .palette => |index| try writer.print(
                    "\x1b]4;{d};rgb:{x:0>4}/{x:0>4}/{x:0>4}",
                    .{
                        index,
                        @as(u16, color.r) * 257,
                        @as(u16, color.g) * 257,
                        @as(u16, color.b) * 257,
                    },
                ),
                .dynamic => |dynamic| try writer.print(
                    "\x1b]{d};rgb:{x:0>4}/{x:0>4}/{x:0>4}",
                    .{
                        @intFromEnum(dynamic),
                        @as(u16, color.r) * 257,
                        @as(u16, color.g) * 257,
                        @as(u16, color.b) * 257,
                    },
                ),
                .special => unreachable,
            }
            try writer.writeAll(value.terminator.string());
        }
        try self.appendOutput(writer.buffered());
    }

    fn queryKittyKeyboard(self: *StreamHandler) !void {
        var buf: [32]u8 = undefined;
        const resp = try std.fmt.bufPrint(&buf, "\x1b[?{}u", .{
            self.term.screens.active.kitty_keyboard.current().int(),
        });
        try self.appendOutput(resp);
    }

    fn apcEnd(self: *StreamHandler) !void {
        var cmd = self.apc.end() orelse {
            self.logApcFailure();
            self.apcDebugReset();
            return;
        };
        defer self.apcDebugReset();
        defer cmd.deinit(self.alloc);

        if (comptime !kitty_graphics_enabled) return;

        switch (cmd) {
            .kitty => |*kitty_cmd| {
                if (self.term.kittyGraphics(self.alloc, kitty_cmd)) |resp| {
                    if (!resp.ok()) {
                        self.logKittyResponseError(kitty_cmd, resp);
                    }
                    var buf: [1024]u8 = undefined;
                    var writer: std.Io.Writer = .fixed(&buf);
                    try resp.encode(&writer);
                    try self.appendOutput(writer.buffered());
                }
            },
            .glyph => {},
        }
    }

    pub fn vt(
        self: *StreamHandler,
        comptime action: StreamAction.Tag,
        value: StreamAction.Value(action),
    ) void {
        self.vtFallible(action, value) catch |err| {
            log.warn("error handling VT action action={} err={}", .{ action, err });
        };
    }

    fn vtFallible(
        self: *StreamHandler,
        comptime action: StreamAction.Tag,
        value: StreamAction.Value(action),
    ) !void {
        switch (action) {
            .erase_display_complete, .erase_display_scrollback => {
                defer self.readonly.vt(action, value);
                if (!value and self.term.screens.active_key == .primary)
                    try self.clearSemanticMarkers();
            },
            .full_reset => {
                defer self.readonly.vt(action, value);
                try self.clearSemanticMarkers();
            },
            .request_mode => try self.requestMode(value.mode),
            .request_mode_unknown => try self.requestModeUnknown(value.mode, value.ansi),
            .size_report => try self.sizeReport(value),
            .xtversion => try self.reportXtversion(),
            .device_attributes => try self.deviceAttributes(value),
            .device_status => try self.deviceStatusReport(value.request),
            .kitty_keyboard_query => try self.queryKittyKeyboard(),
            .color_operation => try self.colorOperation(value),
            .dcs_hook => try self.dcsHook(value),
            .dcs_put => try self.dcsPut(value),
            .dcs_unhook => try self.dcsUnhook(),
            .bell => {
                self.readonly.vt(action, value);
                try self.emitEvent(.bell, &.{});
            },
            .window_title => {
                self.readonly.vt(action, value);
                try self.emitEvent(.title, &.{value.title});
            },
            .report_pwd => {
                self.readonly.vt(action, value);
                try self.emitEvent(.pwd, &.{value.url});
            },
            .clipboard_contents => {
                self.readonly.vt(action, value);
                const kind = [_]u8{value.kind};
                try self.emitEvent(.clipboard, &.{ &kind, value.data });
            },
            .show_desktop_notification => {
                self.readonly.vt(action, value);
                var title_len: [4]u8 = undefined;
                std.mem.writeInt(u32, &title_len, @intCast(value.title.len), .little);
                try self.emitEvent(.notification, &.{ &title_len, value.title, value.body });
            },
            .semantic_prompt => {
                self.readonly.vt(action, value);
                switch (value.action) {
                    .fresh_line_new_prompt, .prompt_start => try self.emitEvent(.prompt_start, &.{}),
                    .end_prompt_start_input, .end_prompt_start_input_terminate_eol => {
                        const block_input = [_]u8{@intFromBool(!std.mem.eql(u8, value.options_unvalidated, "terax_blocks=0"))};
                        try self.emitEvent(.prompt_end, &.{&block_input});
                    },
                    .end_input_start_output => {
                        var marker: [4]u8 = undefined;
                        std.mem.writeInt(u32, &marker, try self.semantic_markers.capture(self.alloc, self.term), .little);
                        const command = if (self.semantic_markers.enabled)
                            value.options_unvalidated[0..@min(value.options_unvalidated.len, 8192)]
                        else
                            "";
                        try self.emitEvent(.end_of_input, &.{ &marker, command });
                    },
                    .end_command => {
                        const exit_value = value.readOption(.exit_code);
                        var payload: [9]u8 = undefined;
                        std.mem.writeInt(u32, payload[0..4], try self.semantic_markers.capture(self.alloc, self.term), .little);
                        payload[4] = @intFromBool(exit_value != null);
                        std.mem.writeInt(i32, payload[5..9], exit_value orelse 0, .little);
                        try self.emitEvent(.end_of_command, &.{&payload});
                    },
                    else => {},
                }
            },
            .apc_start => {
                self.apc.start();
                self.apcDebugReset();
            },
            .apc_put => {
                self.apcDebugCapture(value);
                self.apc.feed(self.alloc, value);
            },
            .apc_end => try self.apcEnd(),
            else => self.readonly.vt(action, value),
        }
    }

    fn clearSemanticMarkers(self: *StreamHandler) !void {
        if (!self.semantic_markers.enabled) return;
        self.semantic_markers.invalidate(self.term);
        try self.emitEvent(.screen_cleared, &.{});
    }
};

const TerminalStream = ghostty.Stream(StreamHandler);

const SemanticMarkers = struct {
    const capacity = 2048;
    const Entry = struct { id: u32, pin: *ghostty.PageList.Pin };
    enabled: bool = false,
    entries: std.ArrayListUnmanaged(Entry) = .empty,
    next_id: u32 = 1,
    first_id: u32 = 1,

    fn clear(self: *SemanticMarkers, alloc: Allocator, term: *ghostty.Terminal) void {
        self.invalidate(term);
        self.entries.deinit(alloc);
        self.entries = .empty;
    }

    fn invalidate(self: *SemanticMarkers, term: *ghostty.Terminal) void {
        const screen = term.screens.get(.primary).?;
        for (self.entries.items) |entry| screen.pages.untrackPin(entry.pin);
        self.entries.clearRetainingCapacity();
        self.first_id = self.next_id;
    }

    fn capture(self: *SemanticMarkers, alloc: Allocator, term: *ghostty.Terminal) !u32 {
        if (!self.enabled or term.screens.active_key != .primary or self.next_id == 0) return 0;
        const screen = term.screens.active;
        const id = self.next_id;
        const slot = (id - self.first_id) % capacity;
        const pin = try screen.pages.trackPin(screen.cursor.page_pin.*);
        errdefer screen.pages.untrackPin(pin);
        if (self.entries.items.len == capacity) {
            screen.pages.untrackPin(self.entries.items[slot].pin);
            self.entries.items[slot] = .{ .id = id, .pin = pin };
        } else {
            try self.entries.append(alloc, .{ .id = id, .pin = pin });
        }
        self.next_id +%= 1;
        return id;
    }

    fn line(self: *const SemanticMarkers, term: *ghostty.Terminal, id: u32) i32 {
        if (id == 0 or id < self.first_id) return -1;
        const slot = (id - self.first_id) % capacity;
        if (slot >= self.entries.items.len) return -1;
        const entry = self.entries.items[slot];
        if (entry.id != id or entry.pin.garbage) return -1;
        const screen = term.screens.get(.primary).?;
        const point = screen.pages.pointFromPin(.screen, entry.pin.*) orelse return -1;
        return @intCast(point.screen.y);
    }
};

const Restty = struct {
    alloc: Allocator,
    term: ghostty.Terminal,
    stream: TerminalStream,
    render_state: ghostty.RenderState,
    buffers: CellBuffers,
    graphemes: std.ArrayListUnmanaged(u32) = .empty,
    link_offsets: std.ArrayListUnmanaged(u32) = .empty,
    link_lengths: std.ArrayListUnmanaged(u32) = .empty,
    link_buffer: std.ArrayListUnmanaged(u8) = .empty,
    link_map: std.HashMapUnmanaged(u32, void, LinkContext, std.hash_map.default_max_load_percentage) = .empty,
    kitty_placements: std.ArrayListUnmanaged(KittyPlacementAbi) = .empty,
    output: std.ArrayListUnmanaged(u8) = .empty,
    events: std.ArrayListUnmanaged(u8) = .empty,
    selection_text: ?[:0]const u8 = null,
    dropped_events: u32 = 0,
    semantic_markers: SemanticMarkers = .{},
    has_render_data: bool = false,
    damage_full: u8 = 1,
    render_update_count: u32 = 0,
    render_reset_count: u32 = 0,
    render_format: RenderFormat = .soa,
    /// GPU format only: glyph intern table, allocated on the first GPU update
    /// and released with the rest of the presentation state.
    glyphs: ?*GlyphTable = null,
    /// Incremented whenever glyph ids are invalidated (table full, release,
    /// compaction, format change). Starts at 1 so a consumer that has seen
    /// epoch 0 resets before its first frame.
    gpu_epoch: u32 = 1,
    gpu_blinking_cells: u32 = 0,
    gpu_any_dirty: u8 = 0,
    /// Cells drawn as glyph 0 because the viewport alone exceeded the table.
    gpu_glyph_overflow: u32 = 0,
    /// Scratch for `restty_line_cells_prepare`.
    line_cells: std.ArrayListUnmanaged(u32) = .empty,
    key_output: [max_key_output_bytes]u8 = undefined,
    key_output_len: u16 = 0,
    cursor: CursorInfo = .{
        .row = 0,
        .col = 0,
        .visible = 0,
        .style = 0,
        .blinking = 0,
        .wide_tail = 0,
        .color_rgba = 0,
        .reserved = 0,
    },
    search: SearchState = .{},
    rows: u16,
    cols: u16,
};

const SearchState = struct {
    query: std.ArrayListUnmanaged(u8) = .empty,
    screen_search: ?ghostty.search.Screen = null,
    viewport_search: ?ghostty.search.Viewport = null,
    viewport_matches: std.ArrayListUnmanaged(SearchViewportSpan) = .empty,
    status: SearchStatus = .{
        .active = 0,
        .pending = 0,
        .complete = 0,
        .reserved = 0,
        .generation = 0,
        .total_matches = 0,
        .selected_index = -1,
    },
    active_screen_key: i32 = -1,
    viewport_dirty: bool = false,
    active_dirty: bool = false,

    fn deinit(self: *SearchState, alloc: Allocator) void {
        self.query.deinit(alloc);
        if (self.screen_search) |*s| s.deinit();
        if (self.viewport_search) |*s| s.deinit();
        self.viewport_matches.deinit(alloc);
        self.* = .{};
    }

    fn resetRuntime(self: *SearchState) void {
        self.viewport_matches.clearRetainingCapacity();
        self.status.active = if (self.query.items.len > 0) 1 else 0;
        self.status.total_matches = 0;
        self.status.selected_index = -1;
        self.status.pending = 0;
        self.status.complete = 0;
        self.viewport_dirty = false;
        self.active_dirty = false;
        self.active_screen_key = -1;
    }

    fn bumpGeneration(self: *SearchState) void {
        self.status.generation +%= 1;
    }

    fn setQuery(self: *SearchState, alloc: Allocator, value: []const u8) !void {
        self.query.clearRetainingCapacity();
        try self.query.appendSlice(alloc, value);
    }

    fn isQueryEqual(self: *const SearchState, value: []const u8) bool {
        return std.mem.eql(u8, self.query.items, value);
    }

    fn isActive(self: *const SearchState) bool {
        return self.status.active != 0;
    }
};

// ---------------------------------------------------------------------------
// GPU render format
// ---------------------------------------------------------------------------
//
// In `RenderFormat.gpu` every viewport cell is one 16-byte record made of four
// little-endian u32 words, stored row-major in one persistent buffer:
//
//   word0  bits  0..23  glyph id (0 = nothing is drawn)
//          bits 24..26  underline style (0 none, 1 single, 2 double, 3 curly,
//                                        4 dotted, 5 dashed)
//          bit  27      strikethrough
//          bit  28      overline
//          bit  29      blink (the glyph blinks; decorations do not)
//          bit  30      wide lead (this cell starts a two-cell glyph)
//          bit  31      reserved, always 0
//   word1  foreground RGBA8 (inverse applied; alpha 255, or 128 when faint)
//   word2  background RGBA8 (inverse applied; alpha 255)
//   word3  underline RGBA8  (alpha 255)
//
// The RGBA words hold bytes [r, g, b, a] in memory order, i.e. the exact
// layout WGSL `unpack4x8unorm` expects (r is the least significant byte, so
// `.x == r`). Spacer tails carry glyph 0 and copy the lead's colors and
// decoration bits so a wide lead's background and underline cover both cells,
// as the structure-of-arrays renderer does. Spacer heads draw nothing and use
// the default colors.

const gpu_cell_words: usize = 4;
const gpu_cell_bytes: usize = gpu_cell_words * @sizeOf(u32);

const GpuAttr = struct {
    const shift: u5 = 24;
    const underline_mask: u32 = 0x7;
    const strikethrough: u32 = 1 << 3;
    const overline: u32 = 1 << 4;
    const blink: u32 = 1 << 5;
    const wide_lead: u32 = 1 << 6;
    const decoration_mask: u32 = underline_mask | strikethrough | overline;
};

const glyph_id_mask: u32 = 0x00FF_FFFF;
const glyph_style_bold: u32 = 1 << 0;
const glyph_style_italic: u32 = 1 << 1;
const glyph_style_count: usize = 4;

/// Glyph ids are dense from 1. The cap bounds table memory, the JavaScript
/// id-to-atlas map and the GPU `glyph_map` storage buffer to 64 KiB each. A
/// full table starts a new epoch (all ids are cleared and the viewport is
/// re-encoded), which costs one atlas-cache lookup per distinct visible glyph
/// and no rasterization, so the cap only has to exceed any realistic visible
/// glyph set (CJK screens rarely exceed a few thousand distinct glyphs).
const max_glyphs: usize = 16 * 1024;
/// Bounds the append-only intern stream (records are `3 + codepoints` words)
/// at 1 MiB so adversarial grapheme clusters cannot grow it past the id cap's
/// footprint.
const max_glyph_stream_words: usize = 256 * 1024;
/// Tables larger than this are released by `restty_render_compact`.
const max_glyphs_after_compact: usize = 2048;
const max_retained_line_words: usize = 16 * 1024;
const max_glyph_codepoints: usize = 1024;

const ascii_glyph_slots: usize = 128 * glyph_style_count;

const SequenceView = struct {
    style: u32,
    codepoints: []const u32,
};

/// Interning table for glyph ids: (codepoint or grapheme sequence, bold,
/// italic) -> dense id. Records are appended to `stream` as
/// `[id][style][codepoint_count][codepoints...]` and never move or change
/// within an epoch, so the same bytes serve as both the identity key store and
/// the buffer handed to JavaScript. `pending_start` marks the first record the
/// consumer has not acknowledged yet.
const GlyphTable = struct {
    stream: std.ArrayListUnmanaged(u32) = .empty,
    offsets: std.ArrayListUnmanaged(u32) = .empty,
    ascii: [ascii_glyph_slots]u32 = [_]u32{0} ** ascii_glyph_slots,
    singles: std.AutoHashMapUnmanaged(u32, u32) = .empty,
    sequences: std.HashMapUnmanaged(
        u32,
        void,
        SequenceContext,
        std.hash_map.default_max_load_percentage,
    ) = .empty,
    pending_start: usize = 0,
    acknowledged: u32 = 0,

    const Error = error{ OutOfMemory, TableFull };

    fn count(self: *const GlyphTable) u32 {
        return @intCast(self.offsets.items.len);
    }

    fn deinit(self: *GlyphTable, alloc: Allocator) void {
        self.stream.deinit(alloc);
        self.offsets.deinit(alloc);
        self.singles.deinit(alloc);
        self.sequences.deinit(alloc);
        self.* = .{};
    }

    /// Starts a new epoch: all ids become invalid.
    fn reset(self: *GlyphTable) void {
        self.stream.clearRetainingCapacity();
        self.offsets.clearRetainingCapacity();
        self.singles.clearRetainingCapacity();
        self.sequences.clearRetainingCapacity();
        @memset(&self.ascii, 0);
        self.pending_start = 0;
        self.acknowledged = 0;
    }

    fn acknowledge(self: *GlyphTable) void {
        self.pending_start = self.stream.items.len;
        self.acknowledged = self.count();
    }

    fn view(self: *const GlyphTable, id: u32) SequenceView {
        const offset = self.offsets.items[id - 1];
        const length = self.stream.items[offset + 2];
        return .{
            .style = self.stream.items[offset + 1],
            .codepoints = self.stream.items[offset + 3 ..][0..length],
        };
    }

    fn context(self: *const GlyphTable) SequenceContext {
        return .{ .table = self };
    }

    fn append(
        self: *GlyphTable,
        alloc: Allocator,
        style: u32,
        codepoints: []const u32,
    ) Error!u32 {
        const words = 3 + codepoints.len;
        if (self.offsets.items.len >= max_glyphs or
            self.stream.items.len + words > max_glyph_stream_words)
        {
            return error.TableFull;
        }
        try self.offsets.ensureUnusedCapacity(alloc, 1);
        try self.stream.ensureUnusedCapacity(alloc, words);
        const id: u32 = @intCast(self.offsets.items.len + 1);
        self.offsets.appendAssumeCapacity(@intCast(self.stream.items.len));
        self.stream.appendAssumeCapacity(id);
        self.stream.appendAssumeCapacity(style);
        self.stream.appendAssumeCapacity(@intCast(codepoints.len));
        self.stream.appendSliceAssumeCapacity(codepoints);
        return id;
    }

    /// One codepoint without a grapheme sequence.
    fn internSingle(
        self: *GlyphTable,
        alloc: Allocator,
        codepoint: u32,
        style: u32,
    ) Error!u32 {
        if (codepoint < 128) {
            const slot = &self.ascii[codepoint * glyph_style_count + style];
            if (slot.* != 0) return slot.*;
            slot.* = try self.append(alloc, style, &.{codepoint});
            return slot.*;
        }
        const key = (codepoint << 2) | style;
        if (self.singles.get(key)) |id| return id;
        try self.singles.ensureUnusedCapacity(alloc, 1);
        const id = try self.append(alloc, style, &.{codepoint});
        self.singles.putAssumeCapacity(key, id);
        return id;
    }

    /// A grapheme cluster (two or more codepoints), interned by content.
    fn internSequence(
        self: *GlyphTable,
        alloc: Allocator,
        style: u32,
        codepoints: []const u32,
    ) Error!u32 {
        const key: SequenceView = .{ .style = style, .codepoints = codepoints };
        const adapter: SequenceAdapter = .{ .table = self };
        if (self.sequences.getKeyAdapted(key, adapter)) |id| return id;
        try self.sequences.ensureUnusedCapacityContext(alloc, 1, self.context());
        const id = try self.append(alloc, style, codepoints);
        self.sequences.putAssumeCapacityContext(id, {}, self.context());
        return id;
    }
};

fn hashSequence(view: SequenceView) u64 {
    return std.hash.Wyhash.hash(view.style, std.mem.sliceAsBytes(view.codepoints));
}

const SequenceContext = struct {
    table: *const GlyphTable,

    pub fn hash(self: SequenceContext, id: u32) u64 {
        return hashSequence(self.table.view(id));
    }

    pub fn eql(self: SequenceContext, a: u32, b: u32) bool {
        const left = self.table.view(a);
        const right = self.table.view(b);
        return left.style == right.style and
            std.mem.eql(u32, left.codepoints, right.codepoints);
    }
};

const SequenceAdapter = struct {
    table: *const GlyphTable,

    pub fn hash(_: SequenceAdapter, key: SequenceView) u64 {
        return hashSequence(key);
    }

    pub fn eql(self: SequenceAdapter, key: SequenceView, id: u32) bool {
        const stored = self.table.view(id);
        return stored.style == key.style and
            std.mem.eql(u32, stored.codepoints, key.codepoints);
    }
};

/// Per-style color and decoration state shared by consecutive cells of a row.
const GpuStyleCache = struct {
    style_id: u16 = std.math.maxInt(u16),
    valid: bool = false,
    fg: u32 = 0,
    bg: u32 = 0,
    ul: u32 = 0,
    attrs: u32 = 0,
    glyph_style: u32 = 0,
    invisible: bool = false,
};

fn packRGBA(rgb: ghostty.color.RGB, a: u8) u32 {
    return @as(u32, rgb.r) | (@as(u32, rgb.g) << 8) | (@as(u32, rgb.b) << 16) | (@as(u32, a) << 24);
}

const LinkContext = struct {
    h: *const Restty,

    fn uri(self: LinkContext, key: u32) []const u8 {
        const index = key - 1;
        const start = self.h.link_offsets.items[index];
        return self.h.link_buffer.items[start..][0..self.h.link_lengths.items[index]];
    }

    pub fn hash(self: LinkContext, key: u32) u64 {
        return std.hash.Wyhash.hash(0, self.uri(key));
    }

    pub fn eql(self: LinkContext, a: u32, b: u32) bool {
        return std.mem.eql(u8, self.uri(a), self.uri(b));
    }
};

const LinkAdapter = struct {
    context: LinkContext,

    pub fn hash(_: LinkAdapter, uri: []const u8) u64 {
        return std.hash.Wyhash.hash(0, uri);
    }

    pub fn eql(self: LinkAdapter, uri: []const u8, key: u32) bool {
        return std.mem.eql(u8, uri, self.context.uri(key));
    }
};

fn rgbFromU32(color: u32) ghostty.color.RGB {
    return .{
        .r = @intCast((color >> 16) & 0xFF),
        .g = @intCast((color >> 8) & 0xFF),
        .b = @intCast(color & 0xFF),
    };
}

fn cursorStyleToAbi(style: CursorVisualStyle) u8 {
    return switch (style) {
        .block => 0,
        .bar => 1,
        .underline => 2,
        .block_hollow => 3,
    };
}

fn ensureScrollingRegion(h: *Restty) void {
    const cols = h.term.cols;
    const rows = h.term.rows;
    if (cols == 0 or rows == 0) return;
    const region = h.term.scrolling_region;
    const invalid =
        region.left >= cols or
        region.right >= cols or
        region.left >= region.right or
        region.top >= rows or
        region.bottom >= rows or
        region.top >= region.bottom;
    if (invalid) {
        h.term.scrolling_region = .{
            .top = 0,
            .bottom = rows - 1,
            .left = 0,
            .right = cols - 1,
        };
    }
}

fn clearSelectionText(h: *Restty) void {
    if (h.selection_text) |value| h.alloc.free(value);
    h.selection_text = null;
}

fn clearAllSelections(h: *Restty) void {
    if (h.term.screens.get(.primary)) |screen| screen.clearSelection();
    if (h.term.screens.get(.alternate)) |screen| screen.clearSelection();
    clearSelectionText(h);
}

fn reconcileSelectionAfterMutation(screen: *ghostty.Screen) void {
    const selection = if (screen.selection) |*value| value else return;
    const start = selection.startPtr();
    const end = selection.endPtr();
    if (start.garbage and end.garbage) {
        screen.clearSelection();
        return;
    }
    start.garbage = false;
    end.garbage = false;
}

fn pinForBufferPoint(
    screen: *ghostty.Screen,
    line: u32,
    column: u16,
) ?ghostty.PageList.Pin {
    const scrollbar = screen.pages.scrollbar();
    if (line >= scrollbar.total or column >= screen.pages.cols) return null;
    const history = scrollbar.total - scrollbar.len;
    if (line < history) {
        return screen.pages.pin(.{ .screen = .{ .x = column, .y = line } });
    }
    return screen.pages.pin(.{ .active = .{
        .x = column,
        .y = line - @as(u32, @intCast(history)),
    } });
}

fn clampI16Unsigned(value: u16) i16 {
    const max = std.math.maxInt(i16);
    const max_u16: u16 = @intCast(max);
    if (value > max_u16) return max;
    return @intCast(value);
}

fn activeScreenKeyInt(h: *Restty) i32 {
    return @intCast(@intFromEnum(h.term.screens.active_key));
}

fn clearSearch(h: *Restty) void {
    h.search.deinit(h.alloc);
}

fn initSearch(h: *Restty, query: []const u8) !void {
    clearSearch(h);
    if (query.len == 0) return;

    try h.search.setQuery(h.alloc, query);
    h.search.status.active = 1;
    h.search.status.pending = 1;
    h.search.status.complete = 0;
    h.search.status.total_matches = 0;
    h.search.status.selected_index = -1;
    h.search.active_screen_key = activeScreenKeyInt(h);
    h.search.viewport_search = try .init(h.alloc, query);
    h.search.screen_search = try .init(
        h.alloc,
        h.term.screens.active,
        query,
    );
    if (h.search.viewport_search) |*vp| vp.active_dirty = true;
    h.search.viewport_dirty = true;
    h.search.active_dirty = true;
    h.search.bumpGeneration();
}

fn ensureSearchActiveScreen(h: *Restty) !void {
    if (!h.search.isActive()) return;
    if (h.search.active_screen_key == activeScreenKeyInt(h) and
        h.search.screen_search != null and
        h.search.viewport_search != null) return;
    try initSearch(h, h.search.query.items);
}

fn refreshSearchMetadata(h: *Restty) void {
    const s = if (h.search.screen_search) |*s| s else {
        h.search.status.total_matches = 0;
        h.search.status.selected_index = -1;
        h.search.status.pending = 0;
        h.search.status.complete = 1;
        return;
    };
    h.search.status.total_matches = @intCast(s.matchesLen());
    h.search.status.selected_index = if (s.selected) |sel| @intCast(sel.idx) else -1;
}

fn refreshViewportMatches(h: *Restty, force_refresh: bool) !void {
    const vp = if (h.search.viewport_search) |*vp| vp else {
        h.search.viewport_matches.clearRetainingCapacity();
        return;
    };
    if (force_refresh) vp.reset();
    vp.active_dirty = true;
    const changed = try vp.update(&h.term.screens.active.pages);
    if (!changed and !force_refresh and !h.search.viewport_dirty) return;

    h.search.viewport_matches.clearRetainingCapacity();
    const selected = if (h.search.screen_search) |*screen_search|
        screen_search.selectedMatch()
    else
        null;
    while (vp.next()) |hl| {
        const slice = hl.chunks.slice();
        const chunk_len = slice.len;
        for (0..chunk_len) |chunk_idx| {
            const row_start = slice.items(.start)[chunk_idx];
            const row_end = slice.items(.end)[chunk_idx];
            const node = slice.items(.node)[chunk_idx];
            var row = row_start;
            while (row < row_end) : (row += 1) {
                const viewport_pt = h.term.screens.active.pages.pointFromPin(.viewport, .{
                    .node = node,
                    .x = 0,
                    .y = row,
                }) orelse continue;
                const start_col: u16 = @intCast(if (chunk_idx == 0 and row == row_start) hl.top_x else 0);
                const end_col_exclusive: u16 = @intCast(if (chunk_idx + 1 == chunk_len and row + 1 == row_end) hl.bot_x + 1 else h.cols);
                if (end_col_exclusive <= start_col) continue;
                try h.search.viewport_matches.append(h.alloc, .{
                    .row = @intCast(viewport_pt.viewport.y),
                    .start_col = start_col,
                    .end_col = end_col_exclusive,
                    .selected = if (selected) |sel|
                        @intFromBool(sel.untracked().eql(hl.untracked()))
                    else
                        0,
                });
            }
        }
    }
    h.search.viewport_dirty = false;
}

fn stepSearch(h: *Restty, budget: u32) !void {
    if (!h.search.isActive()) return;
    try ensureSearchActiveScreen(h);
    const screen_search = if (h.search.screen_search) |*s| s else return;

    // Keep active-area and viewport state fresh while search is active.
    try screen_search.reloadActive();
    h.search.active_dirty = false;

    var remaining: u32 = if (budget == 0) 64 else budget;
    var force_viewport_refresh = h.search.viewport_dirty;
    while (remaining > 0) : (remaining -= 1) {
        screen_search.tick() catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.FeedRequired => {
                try screen_search.feed();
            },
            error.SearchComplete => {
                h.search.status.complete = 1;
                h.search.status.pending = 0;
                force_viewport_refresh = true;
                break;
            },
        };
    }

    if (h.search.status.complete == 0) {
        h.search.status.pending = 1;
    }
    refreshSearchMetadata(h);
    try refreshViewportMatches(h, force_viewport_refresh);
    h.search.bumpGeneration();
}

fn scrollToSelectedSearchMatch(h: *Restty) void {
    const screen_search = if (h.search.screen_search) |*s| s else return;
    const selected = screen_search.selectedMatch() orelse return;
    h.term.screens.active.scroll(.{ .pin = selected.startPin() });
    h.search.viewport_dirty = true;
}

fn kittyFormatToAbi(format: anytype) u8 {
    return switch (format) {
        .gray => 1,
        .gray_alpha => 2,
        .rgb => 3,
        .rgba => 4,
        .png => 100,
    };
}

fn appendKittyPlacement(
    h: *Restty,
    image: ghostty.kitty.graphics.Image,
    placement_id: u32,
    placement_external: u8,
    x: i32,
    y: i32,
    z: i32,
    width: u32,
    height: u32,
    cell_offset_x: u32,
    cell_offset_y: u32,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
) !void {
    const data_ptr: u32 = if (image.data.len == 0) 0 else @intCast(@intFromPtr(image.data.ptr));
    const data_len: u32 = @intCast(image.data.len);

    try h.kitty_placements.append(h.alloc, .{
        .image_id = image.id,
        .image_format = kittyFormatToAbi(image.format),
        .image_width = image.width,
        .image_height = image.height,
        .image_data_ptr = data_ptr,
        .image_data_len = data_len,
        .x = x,
        .y = y,
        .z = z,
        .width = width,
        .height = height,
        .cell_offset_x = cell_offset_x,
        .cell_offset_y = cell_offset_y,
        .source_x = source_x,
        .source_y = source_y,
        .source_width = source_width,
        .source_height = source_height,
        .placement_id = placement_id,
        .placement_external = placement_external,
    });
}

fn collectKittyPlacements(h: *Restty) !void {
    h.kitty_placements.clearRetainingCapacity();
    if (comptime !kitty_graphics_enabled) return;

    const storage = &h.term.screens.active.kitty_images;
    if (!storage.enabled()) return;

    const pages = &h.term.screens.active.pages;
    const top = pages.getTopLeft(.viewport);
    const bot = pages.getBottomRight(.viewport) orelse return;
    const top_screen = pages.pointFromPin(.screen, top) orelse return;
    const bot_screen = pages.pointFromPin(.screen, bot) orelse return;
    const top_y: u32 = top_screen.screen.y;
    const bot_y: u32 = bot_screen.screen.y;

    var it = storage.placements.iterator();
    while (it.next()) |entry| {
        const p = entry.value_ptr;
        switch (p.location) {
            .pin => {},
            .virtual => continue,
        }

        const image = storage.imageById(entry.key_ptr.image_id) orelse continue;
        const rect = p.rect(image, &h.term) orelse continue;
        const img_top = pages.pointFromPin(.screen, rect.top_left) orelse continue;
        const img_bot = pages.pointFromPin(.screen, rect.bottom_right) orelse continue;
        const img_top_y: u32 = img_top.screen.y;
        const img_bot_y: u32 = img_bot.screen.y;
        if (img_top_y > bot_y or img_bot_y < top_y) continue;

        const dest_size = p.pixelSize(image, &h.term);
        if (dest_size.width == 0 or dest_size.height == 0) continue;

        const source_x: u32 = @min(image.width, p.source_x);
        const source_y: u32 = @min(image.height, p.source_y);
        const source_width: u32 = if (p.source_width > 0)
            @min(image.width - source_x, p.source_width)
        else
            image.width;
        const source_height: u32 = if (p.source_height > 0)
            @min(image.height - source_y, p.source_height)
        else
            image.height;
        if (source_width == 0 or source_height == 0) continue;

        const y_pos: i32 = @as(i32, @intCast(img_top_y)) - @as(i32, @intCast(top_y));
        try appendKittyPlacement(
            h,
            image,
            entry.key_ptr.placement_id.id,
            @intFromBool(entry.key_ptr.placement_id.tag == .external),
            @intCast(rect.top_left.x),
            y_pos,
            p.z,
            dest_size.width,
            dest_size.height,
            p.x_offset,
            p.y_offset,
            source_x,
            source_y,
            source_width,
            source_height,
        );
    }

    const cell_width: u32 = if (h.term.cols > 0) @max(1, h.term.width_px / h.term.cols) else 0;
    const cell_height: u32 = if (h.term.rows > 0) @max(1, h.term.height_px / h.term.rows) else 0;
    if (cell_width == 0 or cell_height == 0) return;

    var v_it = ghostty.kitty.graphics.unicode.placementIterator(top, bot);
    while (v_it.next()) |virtual_p| {
        const image = storage.imageById(virtual_p.image_id) orelse continue;
        const rp = virtual_p.renderPlacement(storage, &image, cell_width, cell_height) catch continue;
        if (rp.dest_width == 0 or rp.dest_height == 0) continue;
        const viewport = pages.pointFromPin(.viewport, rp.top_left) orelse continue;

        try appendKittyPlacement(
            h,
            image,
            virtual_p.placement_id,
            if (virtual_p.placement_id == 0) 0 else 1,
            @intCast(rp.top_left.x),
            @intCast(viewport.viewport.y),
            -1,
            rp.dest_width,
            rp.dest_height,
            rp.offset_x,
            rp.offset_y,
            rp.source_x,
            rp.source_y,
            rp.source_width,
            rp.source_height,
        );
    }

    std.mem.sortUnstable(
        KittyPlacementAbi,
        h.kitty_placements.items,
        {},
        struct {
            fn lessThan(ctx: void, lhs: KittyPlacementAbi, rhs: KittyPlacementAbi) bool {
                _ = ctx;
                if (lhs.z != rhs.z) return lhs.z < rhs.z;
                if (lhs.image_id != rhs.image_id) return lhs.image_id < rhs.image_id;
                if (lhs.placement_external != rhs.placement_external) {
                    return lhs.placement_external < rhs.placement_external;
                }
                if (lhs.placement_id != rhs.placement_id) return lhs.placement_id < rhs.placement_id;
                if (lhs.y != rhs.y) return lhs.y < rhs.y;
                return lhs.x < rhs.x;
            }
        }.lessThan,
    );
}

pub export fn restty_create(cols: u16, rows: u16, max_scrollback: u32) ?*Restty {
    return createWithLimits(cols, rows, max_scrollback, null);
}

pub export fn restty_create_with_limits(
    cols: u16,
    rows: u16,
    max_scrollback_bytes: u32,
    max_scrollback_lines: u32,
) ?*Restty {
    return createWithLimits(cols, rows, max_scrollback_bytes, max_scrollback_lines);
}

fn createWithLimits(
    cols: u16,
    rows: u16,
    max_scrollback_bytes: u32,
    max_scrollback_lines: ?u32,
) ?*Restty {
    if (cols == 0 or rows == 0) return null;
    const alloc = std.heap.wasm_allocator;

    var colors: ghostty.Terminal.Colors = .default;
    colors.background = ghostty.color.DynamicRGB.init(.{ .r = 0, .g = 0, .b = 0 });
    colors.foreground = ghostty.color.DynamicRGB.init(.{ .r = 0xFF, .g = 0xFF, .b = 0xFF });
    colors.cursor = ghostty.color.DynamicRGB.init(.{ .r = 0xFF, .g = 0xFF, .b = 0xFF });

    var term = ghostty.Terminal.init(ghostty.TinyIo.init.io(), alloc, .{
        .cols = cols,
        .rows = rows,
        .max_scrollback_bytes = max_scrollback_bytes,
        .max_scrollback_lines = max_scrollback_lines,
        .colors = colors,
    }) catch return null;
    term.width_px = cols;
    term.height_px = rows;

    const handle = alloc.create(Restty) catch {
        term.deinit(alloc);
        return null;
    };
    handle.* = .{
        .alloc = alloc,
        .term = term,
        .stream = undefined,
        .render_state = .empty,
        .buffers = .empty,
        .rows = rows,
        .cols = cols,
    };
    handle.stream = TerminalStream.init(.{
        .allocator = alloc,
        .handler = StreamHandler.init(
            alloc,
            &handle.term,
            &handle.output,
            &handle.events,
            &handle.dropped_events,
            &handle.semantic_markers,
        ),
    });
    return handle;
}

pub export fn restty_destroy(handle: ?*Restty) void {
    const h = handle orelse return;
    clearSelectionText(h);
    h.stream.deinit();
    h.render_state.deinit(h.alloc);
    h.search.deinit(h.alloc);
    h.semantic_markers.clear(h.alloc, &h.term);
    h.term.deinit(h.alloc);
    h.buffers.deinit(h.alloc);
    releaseGlyphTable(h);
    h.line_cells.deinit(h.alloc);
    h.graphemes.deinit(h.alloc);
    h.link_offsets.deinit(h.alloc);
    h.link_lengths.deinit(h.alloc);
    h.link_map.deinit(h.alloc);
    h.link_buffer.deinit(h.alloc);
    h.kitty_placements.deinit(h.alloc);
    h.output.deinit(h.alloc);
    h.events.deinit(h.alloc);
    h.alloc.destroy(h);
}

pub export fn restty_write(handle: ?*Restty, ptr: [*]const u8, len: usize) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (len == 0) return @intFromEnum(ErrorCode.ok);
    const screen_key = h.term.screens.active_key;
    clearSelectionText(h);
    const slice = ptr[0..len];
    ensureScrollingRegion(h);
    h.stream.nextSlice(slice);
    if (screen_key != h.term.screens.active_key) {
        clearAllSelections(h);
    } else {
        reconcileSelectionAfterMutation(h.term.screens.active);
    }
    if (h.search.isActive()) {
        h.search.viewport_dirty = true;
        h.search.active_dirty = true;
    }
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_scroll_viewport(handle: ?*Restty, delta: i32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    h.term.scrollViewport(.{ .delta = delta });
    if (h.search.isActive()) {
        h.search.viewport_dirty = true;
    }
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_scroll_viewport_to(handle: ?*Restty, row: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    h.term.scrollViewport(.{ .row = row });
    if (h.search.isActive()) {
        h.search.viewport_dirty = true;
    }
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_mode(handle: ?*Restty, value: u16, ansi: u8) u8 {
    const h = handle orelse return 0;
    const mode = ghostty.modes.modeFromInt(value, ansi != 0) orelse return 0;
    return @intFromBool(h.term.modes.get(mode));
}

pub export fn restty_mode_bits(handle: ?*Restty) u8 {
    const h = handle orelse return 0;
    var result: u8 = 0;
    if (h.term.screens.active_key == .alternate) result |= 1 << 0;
    if (h.term.modes.get(.bracketed_paste)) result |= 1 << 1;
    if (h.term.modes.get(.focus_event)) result |= 1 << 2;
    if (h.term.modes.get(.mouse_event_x10) or
        h.term.modes.get(.mouse_event_normal) or
        h.term.modes.get(.mouse_event_button) or
        h.term.modes.get(.mouse_event_any)) result |= 1 << 3;
    if (h.term.modes.get(.synchronized_output)) result |= 1 << 4;
    return result;
}

pub export fn restty_set_cursor_options(
    handle: ?*Restty,
    style: u8,
    blinking: u8,
) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    h.term.setDefaultCursorStyle(switch (style) {
        0 => .block,
        1 => .underline,
        2 => .bar,
        else => return @intFromEnum(ErrorCode.invalid_arg),
    });
    h.term.setDefaultCursorBlink(blinking != 0);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_encode_key(
    handle: ?*Restty,
    action_value: i32,
    key_value: i32,
    mods_value: u16,
    consumed_mods_value: u16,
    composing: u8,
    unshifted_codepoint: u32,
    utf8_ptr: [*]const u8,
    utf8_len: usize,
) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    h.key_output_len = 0;
    const action = std.enums.fromInt(ghostty.input.KeyAction, action_value) orelse
        return @intFromEnum(ErrorCode.invalid_arg);
    const key = std.enums.fromInt(ghostty.input.Key, key_value) orelse
        return @intFromEnum(ErrorCode.invalid_arg);
    if (unshifted_codepoint > 0x10FFFF) return @intFromEnum(ErrorCode.invalid_arg);

    var writer: std.Io.Writer = .fixed(&h.key_output);
    ghostty.input.encodeKey(&writer, .{
        .action = action,
        .key = key,
        .mods = @bitCast(mods_value),
        .consumed_mods = @bitCast(consumed_mods_value),
        .composing = composing != 0,
        .utf8 = utf8_ptr[0..utf8_len],
        .unshifted_codepoint = @intCast(unshifted_codepoint),
    }, .fromTerminal(&h.term)) catch return @intFromEnum(ErrorCode.internal);
    h.key_output_len = @intCast(writer.end);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_key_output_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(&h.key_output);
}

pub export fn restty_key_output_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.key_output_len;
}

pub export fn restty_search_set_query(handle: ?*Restty, ptr: [*]const u8, len: usize) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    const query = ptr[0..len];
    if (len == 0) {
        clearSearch(h);
        return @intFromEnum(ErrorCode.ok);
    }
    if (h.search.isActive() and h.search.isQueryEqual(query)) return @intFromEnum(ErrorCode.ok);
    initSearch(h, query) catch |err| return switch (err) {
        error.OutOfMemory => @intFromEnum(ErrorCode.out_of_memory),
    };
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_search_clear(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    clearSearch(h);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_search_step(handle: ?*Restty, budget: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    stepSearch(h, budget) catch |err| return switch (err) {
        error.OutOfMemory => @intFromEnum(ErrorCode.out_of_memory),
    };
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_search_status_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(&h.search.status);
}

pub export fn restty_search_viewport_match_count(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.search.viewport_matches.items.len);
}

pub export fn restty_search_viewport_matches_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.search.viewport_matches.items.len == 0) 0 else @intFromPtr(h.search.viewport_matches.items.ptr);
}

pub export fn restty_search_select_next(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    const screen_search = if (h.search.screen_search) |*s| s else return @intFromEnum(ErrorCode.ok);
    _ = screen_search.select(.next) catch |err| return switch (err) {
        error.OutOfMemory => @intFromEnum(ErrorCode.out_of_memory),
    };
    refreshSearchMetadata(h);
    scrollToSelectedSearchMatch(h);
    refreshViewportMatches(h, true) catch |err| return switch (err) {
        error.OutOfMemory => @intFromEnum(ErrorCode.out_of_memory),
    };
    h.search.bumpGeneration();
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_search_select_prev(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    const screen_search = if (h.search.screen_search) |*s| s else return @intFromEnum(ErrorCode.ok);
    _ = screen_search.select(.prev) catch |err| return switch (err) {
        error.OutOfMemory => @intFromEnum(ErrorCode.out_of_memory),
    };
    refreshSearchMetadata(h);
    scrollToSelectedSearchMatch(h);
    refreshViewportMatches(h, true) catch |err| return switch (err) {
        error.OutOfMemory => @intFromEnum(ErrorCode.out_of_memory),
    };
    h.search.bumpGeneration();
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_scrollbar_total(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const sb = h.term.screens.active.pages.scrollbar();
    return @intCast(sb.total);
}

pub export fn restty_scrollbar_offset(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const sb = h.term.screens.active.pages.scrollbar();
    return @intCast(sb.offset);
}

pub export fn restty_scrollbar_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const sb = h.term.screens.active.pages.scrollbar();
    return @intCast(sb.len);
}

pub export fn restty_semantic_markers_enable(handle: ?*Restty, enabled: u8) void {
    const h = handle orelse return;
    h.semantic_markers.enabled = enabled != 0;
    if (enabled == 0) h.semantic_markers.clear(h.alloc, &h.term);
}

pub export fn restty_semantic_marker_line(handle: ?*Restty, id: u32) i32 {
    const h = handle orelse return -1;
    return h.semantic_markers.line(&h.term, id);
}

pub export fn restty_semantic_marker_count(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.semantic_markers.entries.items.len);
}

pub export fn restty_semantic_marker_column(handle: ?*Restty, id: u32) i32 {
    const h = handle orelse return -1;
    if (h.semantic_markers.line(&h.term, id) < 0) return -1;
    return h.semantic_markers.entries.items[(id - h.semantic_markers.first_id) % SemanticMarkers.capacity].pin.x;
}

pub export fn restty_text_range_prepare(
    handle: ?*Restty,
    start_line: u32,
    start_col: u16,
    end_line: u32,
    end_col: u16,
) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    clearSelectionText(h);
    const screen = h.term.screens.active;
    const start = pinForBufferPoint(screen, start_line, start_col) orelse return @intFromEnum(ErrorCode.invalid_arg);
    const end = pinForBufferPoint(screen, end_line, end_col) orelse return @intFromEnum(ErrorCode.invalid_arg);
    h.selection_text = screen.selectionString(h.alloc, .{
        .sel = ghostty.Selection.init(start, end, false),
        .trim = true,
    }) catch return @intFromEnum(ErrorCode.out_of_memory);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_selection_set(
    handle: ?*Restty,
    start_line: u32,
    start_col: u16,
    end_line: u32,
    end_col: u16,
    rectangular: u8,
) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    const screen = h.term.screens.active;
    const start = pinForBufferPoint(screen, start_line, start_col) orelse
        return @intFromEnum(ErrorCode.invalid_arg);
    const end = pinForBufferPoint(screen, end_line, end_col) orelse
        return @intFromEnum(ErrorCode.invalid_arg);
    screen.select(ghostty.Selection.init(start, end, rectangular != 0)) catch
        return @intFromEnum(ErrorCode.out_of_memory);
    clearSelectionText(h);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_selection_clear(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    h.term.screens.active.clearSelection();
    clearSelectionText(h);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_selection_active(handle: ?*Restty) u8 {
    const h = handle orelse return 0;
    return @intFromBool(h.term.screens.active.selection != null);
}

pub export fn restty_selection_start_line(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const sel = h.term.screens.active.selection orelse return 0;
    const point = h.term.screens.active.pages.pointFromPin(.screen, sel.start()) orelse return 0;
    return point.screen.y;
}

pub export fn restty_selection_start_col(handle: ?*Restty) u16 {
    const h = handle orelse return 0;
    const sel = h.term.screens.active.selection orelse return 0;
    return sel.start().x;
}

pub export fn restty_selection_end_line(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const sel = h.term.screens.active.selection orelse return 0;
    const point = h.term.screens.active.pages.pointFromPin(.screen, sel.end()) orelse return 0;
    return point.screen.y;
}

pub export fn restty_selection_end_col(handle: ?*Restty) u16 {
    const h = handle orelse return 0;
    const sel = h.term.screens.active.selection orelse return 0;
    return sel.end().x;
}

pub export fn restty_selection_rectangular(handle: ?*Restty) u8 {
    const h = handle orelse return 0;
    const sel = h.term.screens.active.selection orelse return 0;
    return @intFromBool(sel.rectangle);
}

pub export fn restty_selection_text_prepare(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    clearSelectionText(h);
    const sel = h.term.screens.active.selection orelse
        return @intFromEnum(ErrorCode.ok);
    h.selection_text = h.term.screens.active.selectionString(h.alloc, .{
        .sel = sel,
        .trim = true,
    }) catch return @intFromEnum(ErrorCode.out_of_memory);
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_selection_text_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.selection_text) |value| @intFromPtr(value.ptr) else 0;
}

pub export fn restty_selection_text_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return if (h.selection_text) |value| @intCast(value.len) else 0;
}

pub export fn restty_output_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.output.items.len == 0) 0 else @intFromPtr(h.output.items.ptr);
}

pub export fn restty_output_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.output.items.len);
}

pub export fn restty_output_consume(handle: ?*Restty, len: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (len == 0 or h.output.items.len == 0) return @intFromEnum(ErrorCode.ok);

    const n: usize = @min(@as(usize, len), h.output.items.len);
    if (n >= h.output.items.len) {
        if (h.output.capacity > max_retained_output_bytes) {
            h.output.deinit(h.alloc);
            h.output = .empty;
        } else {
            h.output.clearRetainingCapacity();
        }
        return @intFromEnum(ErrorCode.ok);
    }

    const remaining = h.output.items.len - n;
    std.mem.copyForwards(u8, h.output.items[0..remaining], h.output.items[n..]);
    h.output.items.len = remaining;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_events_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.events.items.len == 0) 0 else @intFromPtr(h.events.items.ptr);
}

pub export fn restty_events_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.events.items.len);
}

pub export fn restty_events_consume(handle: ?*Restty, len: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (len == 0 or h.events.items.len == 0) return @intFromEnum(ErrorCode.ok);
    const count = @min(@as(usize, len), h.events.items.len);
    if (count == h.events.items.len) {
        if (h.events.capacity > 64 * 1024) {
            h.events.deinit(h.alloc);
            h.events = .empty;
        } else {
            h.events.clearRetainingCapacity();
        }
        return @intFromEnum(ErrorCode.ok);
    }
    const remaining = h.events.items.len - count;
    std.mem.copyForwards(u8, h.events.items[0..remaining], h.events.items[count..]);
    h.events.items.len = remaining;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_take_dropped_events(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const count = h.dropped_events;
    h.dropped_events = 0;
    return count;
}

pub export fn restty_kitty_keyboard_flags(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.screens.active.kitty_keyboard.current().int();
}

pub export fn restty_set_default_colors(handle: ?*Restty, fg: u32, bg: u32, cursor: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (fg != 0xFFFF_FFFF) {
        const rgb = rgbFromU32(fg);
        h.term.colors.foreground.default = rgb;
        h.term.colors.foreground.override = null;
    }
    if (bg != 0xFFFF_FFFF) {
        const rgb = rgbFromU32(bg);
        h.term.colors.background.default = rgb;
        h.term.colors.background.override = null;
    }
    if (cursor != 0xFFFF_FFFF) {
        const rgb = rgbFromU32(cursor);
        h.term.colors.cursor.default = rgb;
        h.term.colors.cursor.override = null;
    }
    h.term.flags.dirty.palette = true;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_set_palette(handle: ?*Restty, ptr: [*]const u8, len: usize) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (len == 0) return @intFromEnum(ErrorCode.ok);
    const count: usize = if (len > 256) 256 else len;
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const base = i * 3;
        const rgb = ghostty.color.RGB{
            .r = ptr[base],
            .g = ptr[base + 1],
            .b = ptr[base + 2],
        };
        h.term.colors.palette.set(@intCast(i), rgb);
    }
    h.term.flags.dirty.palette = true;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_reset_palette(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    h.term.colors.palette.resetAll();
    h.term.flags.dirty.palette = true;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_resize(handle: ?*Restty, cols: u16, rows: u16) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (cols == 0 or rows == 0) return @intFromEnum(ErrorCode.invalid_arg);
    h.term.resize(h.alloc, .{
        .cols = cols,
        .rows = rows,
    }) catch return @intFromEnum(ErrorCode.internal);
    clearSelectionText(h);
    reconcileSelectionAfterMutation(h.term.screens.active);
    ensureScrollingRegion(h);
    if (h.search.isActive()) {
        h.search.viewport_dirty = true;
        h.search.active_dirty = true;
    }
    return @intFromEnum(ErrorCode.ok);
}

/// Changes the primary-screen scrollback limits at runtime. Lowering a limit
/// prunes complete historical pages immediately; zero is rejected because it
/// would erase history instead of bounding it.
pub export fn restty_set_scrollback_limits(
    handle: ?*Restty,
    max_bytes: u32,
    max_lines: u32,
) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (max_bytes == 0 or max_lines == 0) return @intFromEnum(ErrorCode.invalid_arg);
    h.term.setScrollbackMaxBytes(max_bytes);
    h.term.setScrollbackMaxLines(max_lines);
    clearSelectionText(h);
    reconcileSelectionAfterMutation(h.term.screens.active);
    if (h.search.isActive()) {
        h.search.viewport_dirty = true;
        h.search.active_dirty = true;
    }
    return @intFromEnum(ErrorCode.ok);
}

/// Bytes of page memory the primary screen currently holds (scrollback plus
/// the active area): the quantity the byte limit is compared against.
pub export fn restty_scrollback_page_bytes(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const screen = h.term.screens.get(.primary) orelse return 0;
    return @intCast(@min(screen.pages.page_size, std.math.maxInt(u32)));
}

pub export fn restty_set_pixel_size(handle: ?*Restty, width_px: u32, height_px: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (width_px == 0 or height_px == 0) return @intFromEnum(ErrorCode.invalid_arg);
    h.term.width_px = width_px;
    h.term.height_px = height_px;
    return @intFromEnum(ErrorCode.ok);
}

const GpuWriteResult = enum { ok, table_full };

/// Interns the hyperlink under `(x, y)` and returns its 1-based id, or 0.
/// URIs are copied into bridge-owned storage so ids never point into pages
/// that Ghostty may recycle.
fn linkIdForCell(
    h: *Restty,
    link_context: LinkContext,
    page_ptr: anytype,
    x: usize,
    y: usize,
) error{OutOfMemory}!u32 {
    const rac = page_ptr.getRowAndCell(x, y);
    const link_id = page_ptr.lookupHyperlink(rac.cell) orelse return 0;
    const link = page_ptr.hyperlink_set.get(page_ptr.memory, link_id);
    const uri = link.uri.slice(page_ptr.memory);
    if (uri.len == 0) return 0;
    if (h.link_map.getKeyAdapted(uri, LinkAdapter{ .context = link_context })) |existing| {
        return existing;
    }
    const offset: usize = h.link_buffer.items.len;
    try h.link_buffer.appendSlice(h.alloc, uri);
    try h.link_offsets.append(h.alloc, @intCast(offset));
    try h.link_lengths.append(h.alloc, @intCast(uri.len));
    const new_index: u32 = @intCast(h.link_offsets.items.len);
    try h.link_map.putContext(h.alloc, new_index, {}, link_context);
    return new_index;
}

fn clearLinkTables(h: *Restty) void {
    h.link_offsets.clearRetainingCapacity();
    h.link_lengths.clearRetainingCapacity();
    h.link_map.clearRetainingCapacity();
    h.link_buffer.clearRetainingCapacity();
}

fn writeRowMetadata(h: *Restty, r: usize, wrapped: bool, selection: ?[2]u16) void {
    h.buffers.row_wrapped[r] = @intFromBool(wrapped);
    if (selection) |sel| {
        h.buffers.row_selection_start[r] = clampI16Unsigned(sel[0]);
        h.buffers.row_selection_end[r] = clampI16Unsigned(sel[1]);
    } else {
        h.buffers.row_selection_start[r] = -1;
        h.buffers.row_selection_end[r] = -1;
    }
}

/// Structure-of-arrays encoding of every natively dirty row (or all rows on
/// full damage). This is the original bridge format and is deliberately
/// unchanged by the GPU format work.
fn writeSoaRows(h: *Restty, full_damage: bool) error{OutOfMemory}!void {
    const row_data = h.render_state.row_data.slice();
    const row_pins = row_data.items(.pin);
    const row_cells = row_data.items(.cells);
    const row_selection = row_data.items(.selection);
    const row_raw = row_data.items(.raw);
    const row_native_dirty = row_data.items(.dirty);

    const palette = &h.render_state.colors.palette;
    const default_fg = h.render_state.colors.foreground;
    const default_bg = h.render_state.colors.background;

    const link_context: LinkContext = .{ .h = h };

    var r: usize = 0;
    while (r < h.rows) : (r += 1) {
        if (!full_damage and !row_native_dirty[r]) continue;
        h.buffers.row_dirty[r] = 1;
        writeRowMetadata(h, r, row_raw[r].wrap_continuation, row_selection[r]);

        const list = row_cells[r];
        const cell_slice = list.slice();
        const raw_cells = cell_slice.items(.raw);
        const cell_graphemes = cell_slice.items(.grapheme);
        const cell_styles = cell_slice.items(.style);
        const pin = row_pins[r];
        const page_ptr = pin.node.page();

        var idx: usize = r * @as(usize, h.cols);
        var c: usize = 0;
        while (c < h.cols) : (c += 1) {
            const raw = raw_cells[c];
            const raw_codepoint = raw.codepoint();
            const is_kitty_placeholder = if (comptime kitty_graphics_enabled)
                raw_codepoint == ghostty.kitty.graphics.unicode.placeholder
            else
                false;

            h.buffers.codepoints[idx] = @intCast(raw_codepoint);
            h.buffers.content_tags[idx] = @intFromEnum(raw.content_tag);
            h.buffers.wide[idx] = @intFromEnum(raw.wide);

            var flags: u16 = 0;
            if (raw.hyperlink) flags |= CellFlags.hyperlink;
            if (raw.hasGrapheme() and !is_kitty_placeholder) flags |= CellFlags.has_grapheme;
            if (raw.protected) flags |= CellFlags.protected;
            h.buffers.flags[idx] = flags;

            var style: ghostty.Style = .{};
            if (raw.style_id != 0) {
                style = cell_styles[c];
            }

            h.buffers.style_flags[idx] = @as(u16, @bitCast(style.flags));
            h.buffers.underline_styles[idx] = @intFromEnum(style.flags.underline);
            h.buffers.link_ids[idx] = 0;

            const fg = style.fg(.{ .default = default_fg, .palette = palette, .bold = null });
            const bg = style.bg(&raw, palette) orelse default_bg;
            const ul = style.underlineColor(palette) orelse
                if (style.flags.inverse) bg else fg;

            h.buffers.fg_rgba[idx] = packRGBA(fg, 0xFF);
            h.buffers.bg_rgba[idx] = packRGBA(bg, 0xFF);
            h.buffers.ul_rgba[idx] = packRGBA(ul, 0xFF);

            if (raw.hasGrapheme() and !is_kitty_placeholder) {
                const grapheme_slice = cell_graphemes[c];
                const offset = h.graphemes.items.len;
                if (grapheme_slice.len > 0) {
                    try h.graphemes.ensureUnusedCapacity(h.alloc, grapheme_slice.len);
                    for (grapheme_slice) |cp| {
                        h.graphemes.appendAssumeCapacity(@intCast(cp));
                    }
                }
                h.buffers.grapheme_offsets[idx] = @intCast(offset);
                h.buffers.grapheme_lengths[idx] = @intCast(grapheme_slice.len);
            } else {
                h.buffers.grapheme_offsets[idx] = 0;
                h.buffers.grapheme_lengths[idx] = 0;
            }

            if (raw.hyperlink) {
                h.buffers.link_ids[idx] = try linkIdForCell(h, link_context, page_ptr, c, pin.y);
            }

            idx += 1;
        }
    }
}

/// Stores a record and returns a non-zero value if it differs from the one
/// it replaced. Two 64-bit compares halve the memory operations of four words.
inline fn storeRecord(slot: *[gpu_cell_words]u32, words: [4]u32) u64 {
    const wide: *[2]u64 = @ptrCast(@alignCast(slot));
    const first = @as(u64, words[0]) | (@as(u64, words[1]) << 32);
    const second = @as(u64, words[2]) | (@as(u64, words[3]) << 32);
    const changed = (wide[0] ^ first) | (wide[1] ^ second);
    wide[0] = first;
    wide[1] = second;
    return changed;
}

/// Resolves everything a record needs from one style. `raw` supplies the
/// cell-local background for color-only cells.
fn resolveGpuStyle(
    style: ghostty.Style,
    raw: *const ghostty.Cell,
    palette: anytype,
    default_fg: ghostty.color.RGB,
    default_bg: ghostty.color.RGB,
) GpuStyleCache {
    // Same source colors as the structure-of-arrays path so both formats agree.
    const fg = style.fg(.{ .default = default_fg, .palette = palette, .bold = null });
    const bg = style.bg(raw, palette) orelse default_bg;
    const ul = style.underlineColor(palette) orelse
        if (style.flags.inverse) bg else fg;
    const shown_fg = if (style.flags.inverse) bg else fg;
    const shown_bg = if (style.flags.inverse) fg else bg;

    var attrs: u32 = @intFromEnum(style.flags.underline);
    if (style.flags.strikethrough) attrs |= GpuAttr.strikethrough;
    if (style.flags.overline) attrs |= GpuAttr.overline;
    if (style.flags.blink) attrs |= GpuAttr.blink;

    var glyph_style: u32 = 0;
    if (style.flags.bold) glyph_style |= glyph_style_bold;
    if (style.flags.italic) glyph_style |= glyph_style_italic;

    return .{
        .valid = true,
        .fg = packRGBA(shown_fg, if (style.flags.faint) 128 else 0xFF),
        .bg = packRGBA(shown_bg, 0xFF),
        .ul = packRGBA(ul, 0xFF),
        .attrs = attrs,
        .glyph_style = glyph_style,
        .invisible = style.flags.invisible,
    };
}

const InternOutcome = union(enum) {
    glyph: u32,
    table_full,
};

/// Slow path of glyph lookup for one cell: sequences, non-ASCII codepoints,
/// first sight of an ASCII glyph, Kitty placeholders and overflow handling.
fn internCell(
    h: *Restty,
    table: *GlyphTable,
    codepoint: u32,
    extras: []const u21,
    style: u32,
    sequence: *[max_glyph_codepoints]u32,
    allow_overflow: bool,
) error{OutOfMemory}!InternOutcome {
    const is_kitty_placeholder = if (comptime kitty_graphics_enabled)
        codepoint == ghostty.kitty.graphics.unicode.placeholder
    else
        false;
    if (is_kitty_placeholder) return .{ .glyph = 0 };
    if (extras.len + 1 > max_glyph_codepoints) {
        // An absurdly long cluster is never interned.
        h.gpu_glyph_overflow +|= 1;
        return .{ .glyph = 0 };
    }
    const interned = if (extras.len == 0)
        table.internSingle(h.alloc, codepoint, style)
    else blk: {
        sequence[0] = codepoint;
        for (extras, 1..) |cp, i| sequence[i] = cp;
        break :blk table.internSequence(h.alloc, style, sequence[0 .. extras.len + 1]);
    };
    return .{ .glyph = interned catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.TableFull => {
            if (!allow_overflow) return .table_full;
            h.gpu_glyph_overflow +|= 1;
            return .{ .glyph = 0 };
        },
    } };
}

/// GPU record encoding. Every row is encoded when `rewrite_all` (Ghostty
/// reports full damage, for example after a scroll or palette change), else
/// only natively dirty rows. A row is reported dirty only when one of its
/// words differs from the record already stored, or when `invalidate_all`
/// says the stored records are stale (first frame, resize, new epoch...).
/// Returns `.table_full` (after partial writes) when the glyph table cannot
/// hold another glyph; the caller starts a new epoch and re-encodes the
/// viewport with `allow_overflow` set.
fn writeGpuRows(
    h: *Restty,
    rewrite_all: bool,
    invalidate_all: bool,
    allow_overflow: bool,
) error{OutOfMemory}!GpuWriteResult {
    const table = h.glyphs.?;
    const rows: usize = h.rows;
    const cols: usize = h.cols;

    const row_data = h.render_state.row_data.slice();
    const row_pins = row_data.items(.pin);
    const row_cells = row_data.items(.cells);
    const row_selection = row_data.items(.selection);
    const row_raw = row_data.items(.raw);
    const row_native_dirty = row_data.items(.dirty);

    const palette = &h.render_state.colors.palette;
    const default_fg = h.render_state.colors.foreground;
    const default_bg = h.render_state.colors.background;
    // An empty default-style cell, also what a spacer head draws.
    const default_fg_word = packRGBA(default_fg, 0xFF);
    const blank_words: [4]u32 = .{
        0,
        default_fg_word,
        packRGBA(default_bg, 0xFF),
        default_fg_word,
    };

    const link_context: LinkContext = .{ .h = h };

    var blinking: u32 = if (rewrite_all) 0 else h.gpu_blinking_cells;
    if (rewrite_all) @memset(h.buffers.row_blink[0..rows], 0);
    var sequence: [max_glyph_codepoints]u32 = undefined;

    var r: usize = 0;
    while (r < rows) : (r += 1) {
        if (!rewrite_all and !row_native_dirty[r]) continue;
        writeRowMetadata(h, r, row_raw[r].wrap_continuation, row_selection[r]);

        const list = row_cells[r];
        const cell_slice = list.slice();
        const raw_cells = cell_slice.items(.raw);
        const cell_graphemes = cell_slice.items(.grapheme);
        const cell_styles = cell_slice.items(.style);
        const pin = row_pins[r];
        const page_ptr = pin.node.page();

        const link_ids = h.buffers.link_ids[r * cols ..][0..cols];
        @memset(link_ids, 0);
        const records = h.buffers.records[r * cols * gpu_cell_words ..][0 .. cols * gpu_cell_words];

        var diff: u64 = 0;
        var blink_cells: u16 = 0;
        var cache: GpuStyleCache = .{};
        var scratch: GpuStyleCache = undefined;
        var lead: ?[4]u32 = null;

        var c: usize = 0;
        while (c < cols) : (c += 1) {
            const raw = raw_cells[c];
            const slot = records[c * gpu_cell_words ..][0..gpu_cell_words];

            // Fast path: the all-zero cell is the default style with no text.
            if (@as(u64, @bitCast(raw)) == 0) {
                diff |= storeRecord(slot, blank_words);
                lead = null;
                continue;
            }

            const bg_only = switch (raw.content_tag) {
                .bg_color_palette, .bg_color_rgb => true,
                .codepoint, .codepoint_grapheme => false,
            };

            // Color-only cells take their background from the cell itself, so
            // they bypass the per-style cache.
            const resolved: *const GpuStyleCache = if (bg_only) blk: {
                const style: ghostty.Style = if (raw.style_id != 0) cell_styles[c] else .{};
                scratch = resolveGpuStyle(style, &raw, palette, default_fg, default_bg);
                break :blk &scratch;
            } else blk: {
                if (!cache.valid or cache.style_id != raw.style_id) {
                    const style: ghostty.Style = if (raw.style_id != 0) cell_styles[c] else .{};
                    cache = resolveGpuStyle(style, &raw, palette, default_fg, default_bg);
                    cache.style_id = raw.style_id;
                }
                break :blk &cache;
            };

            var words: [4]u32 = undefined;
            switch (raw.wide) {
                .spacer_head => {
                    // A wide glyph continues on the next row; draw nothing.
                    words = blank_words;
                },
                .spacer_tail => {
                    if (lead) |l| {
                        const decoration = ((l[0] >> GpuAttr.shift) & GpuAttr.decoration_mask) << GpuAttr.shift;
                        words = .{ decoration, l[1], l[2], l[3] };
                    } else {
                        words = .{
                            (resolved.attrs & GpuAttr.decoration_mask) << GpuAttr.shift,
                            resolved.fg,
                            resolved.bg,
                            resolved.ul,
                        };
                    }
                },
                .narrow, .wide => {
                    const codepoint: u32 = raw.codepoint();
                    var glyph: u32 = 0;
                    if (codepoint > 32 and !resolved.invisible) {
                        // Plain ASCII is the overwhelmingly common case: one
                        // table read, no hashing, no grapheme or placeholder test.
                        const ascii_hit: u32 = if (codepoint < 128 and !raw.hasGrapheme())
                            table.ascii[codepoint * glyph_style_count + resolved.glyph_style]
                        else
                            0;
                        if (ascii_hit != 0) {
                            glyph = ascii_hit;
                        } else {
                            glyph = switch (try internCell(
                                h,
                                table,
                                codepoint,
                                if (raw.hasGrapheme()) cell_graphemes[c] else &.{},
                                resolved.glyph_style,
                                &sequence,
                                allow_overflow,
                            )) {
                                .glyph => |id| id,
                                .table_full => return .table_full,
                            };
                        }
                    }

                    var attrs = resolved.attrs;
                    if (raw.wide == .wide) attrs |= GpuAttr.wide_lead;
                    if (glyph != 0 and (attrs & GpuAttr.blink) != 0) blink_cells += 1;
                    words = .{
                        glyph | (attrs << GpuAttr.shift),
                        resolved.fg,
                        resolved.bg,
                        resolved.ul,
                    };
                },
            }
            lead = if (raw.wide == .wide) words else null;

            if (raw.hyperlink) {
                link_ids[c] = try linkIdForCell(h, link_context, page_ptr, c, pin.y);
            }

            diff |= storeRecord(slot, words);
        }

        h.buffers.row_dirty[r] = @intFromBool(invalidate_all or diff != 0);
        blinking = blinking - h.buffers.row_blink[r] + blink_cells;
        h.buffers.row_blink[r] = blink_cells;
    }

    h.gpu_blinking_cells = blinking;
    return .ok;
}

fn releaseGlyphTable(h: *Restty) void {
    if (h.glyphs) |table| {
        table.deinit(h.alloc);
        h.alloc.destroy(table);
        h.glyphs = null;
    }
    // Ids from the released table are meaningless, whether or not one existed.
    h.gpu_epoch +%= 1;
    h.gpu_blinking_cells = 0;
    h.gpu_any_dirty = 0;
}

fn releaseLineScratch(h: *Restty) void {
    h.line_cells.deinit(h.alloc);
    h.line_cells = .empty;
}

pub export fn restty_render_update(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    collectKittyPlacements(h) catch return @intFromEnum(ErrorCode.out_of_memory);
    if (h.render_update_count >= render_state_reset_interval) {
        h.render_state.deinit(h.alloc);
        h.render_state = .empty;
        h.has_render_data = false;
        h.render_update_count = 0;
        h.render_reset_count +%= 1;
    }
    h.render_state.update(h.alloc, &h.term) catch return @intFromEnum(ErrorCode.internal);
    h.render_update_count += 1;

    const gpu = h.render_format == .gpu;
    const new_rows: u16 = @intCast(h.render_state.rows);
    const new_cols: u16 = @intCast(h.render_state.cols);
    const expected_len: usize = @as(usize, new_rows) * @as(usize, new_cols);

    if (new_rows != h.rows or
        new_cols != h.cols or
        h.buffers.format != h.render_format or
        h.buffers.cell_capacity < expected_len)
    {
        _ = h.buffers.ensureCapacity(h.alloc, h.render_format, new_rows, new_cols) catch
            return @intFromEnum(ErrorCode.out_of_memory);
        h.rows = new_rows;
        h.cols = new_cols;
        h.has_render_data = false;
    }

    const native_damage = h.render_state.dirty;
    const dynamic_buffers_need_compaction =
        h.graphemes.items.len > max_retained_grapheme_codepoints or
        h.link_buffer.items.len > max_retained_link_bytes or
        h.link_offsets.items.len > max_retained_link_count;
    var full_damage = !h.has_render_data or
        native_damage == .full or
        dynamic_buffers_need_compaction;

    @memset(h.buffers.row_dirty[0..h.rows], 0);
    if (gpu) {
        // Stored records are stale (every row must be uploaded) only when no
        // render data exists for this geometry or the glyph ids were
        // invalidated. Other full damage (a scroll, a palette change) still
        // re-encodes every row but compares it with the stored record, so
        // rows whose bytes are unchanged are not reported.
        var invalidate_all = !h.has_render_data;
        if (h.glyphs == null) {
            h.glyphs = h.alloc.create(GlyphTable) catch
                return @intFromEnum(ErrorCode.out_of_memory);
            h.glyphs.?.* = .{};
            invalidate_all = true;
            full_damage = true;
        }
        var allow_overflow = false;
        while (true) {
            if (full_damage) clearLinkTables(h);
            const result = writeGpuRows(h, full_damage, invalidate_all, allow_overflow) catch {
                // Records were partly rewritten without reporting the rows:
                // the next update must treat every stored record as stale.
                h.has_render_data = false;
                return @intFromEnum(ErrorCode.out_of_memory);
            };
            if (result == .ok) break;

            // The table is full: start a new epoch and re-encode everything.
            // A second overflow means the viewport alone has more distinct
            // glyphs than the table holds; those cells draw nothing.
            h.glyphs.?.reset();
            h.gpu_epoch +%= 1;
            h.gpu_blinking_cells = 0;
            full_damage = true;
            invalidate_all = true;
            allow_overflow = true;
            @memset(h.buffers.row_dirty[0..h.rows], 0);
        }
        // `damage_full` below reports invalidation, not merely native full damage.
        full_damage = invalidate_all;
        var any_dirty = full_damage;
        if (!any_dirty) {
            for (h.buffers.row_dirty[0..h.rows]) |dirty| {
                if (dirty != 0) {
                    any_dirty = true;
                    break;
                }
            }
        }
        h.gpu_any_dirty = @intFromBool(any_dirty);
    } else {
        if (full_damage) {
            h.graphemes.clearRetainingCapacity();
            clearLinkTables(h);
        }
        writeSoaRows(h, full_damage) catch return @intFromEnum(ErrorCode.out_of_memory);
    }

    h.has_render_data = true;
    h.damage_full = @intFromBool(full_damage);

    const cursor_state = h.render_state.cursor;
    const cursor_visible = cursor_state.visible and cursor_state.viewport != null;
    if (cursor_state.viewport) |vp| {
        h.cursor.row = @intCast(vp.y);
        h.cursor.col = @intCast(vp.x);
        h.cursor.wide_tail = if (vp.wide_tail) 1 else 0;
    } else {
        h.cursor.row = 0;
        h.cursor.col = 0;
        h.cursor.wide_tail = 0;
    }
    h.cursor.visible = if (cursor_visible) 1 else 0;
    h.cursor.style = cursorStyleToAbi(cursor_state.visual_style);
    h.cursor.blinking = if (cursor_state.blinking) 1 else 0;
    h.cursor.color_rgba = if (h.render_state.colors.cursor) |c| packRGBA(c, 0xFF) else 0;

    h.render_state.clean();

    return @intFromEnum(ErrorCode.ok);
}

/// Selects the per-cell format written by `restty_render_update`: 0 =
/// structure-of-arrays (default), 1 = GPU records. Changing the format
/// releases the other format's buffers and forces full damage on the next
/// update; setting the current format is a no-op.
pub export fn restty_set_render_format(handle: ?*Restty, format: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    const next: RenderFormat = switch (format) {
        0 => .soa,
        1 => .gpu,
        else => return @intFromEnum(ErrorCode.invalid_arg),
    };
    if (next == h.render_format) return @intFromEnum(ErrorCode.ok);

    h.render_format = next;
    h.buffers.deinit(h.alloc);
    h.buffers = .empty;
    releaseGlyphTable(h);
    h.graphemes.deinit(h.alloc);
    h.graphemes = .empty;
    h.link_offsets.deinit(h.alloc);
    h.link_offsets = .empty;
    h.link_lengths.deinit(h.alloc);
    h.link_lengths = .empty;
    h.link_map.deinit(h.alloc);
    h.link_map = .empty;
    h.link_buffer.deinit(h.alloc);
    h.link_buffer = .empty;
    h.has_render_data = false;
    h.damage_full = 1;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_render_format(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intFromEnum(h.render_format);
}

pub export fn restty_render_release(handle: ?*Restty) void {
    const h = handle orelse return;
    h.render_state.deinit(h.alloc);
    h.render_state = .empty;
    h.buffers.deinit(h.alloc);
    h.buffers = .empty;
    releaseGlyphTable(h);
    releaseLineScratch(h);
    h.graphemes.deinit(h.alloc);
    h.graphemes = .empty;
    h.link_offsets.deinit(h.alloc);
    h.link_offsets = .empty;
    h.link_lengths.deinit(h.alloc);
    h.link_lengths = .empty;
    h.link_map.deinit(h.alloc);
    h.link_map = .empty;
    h.link_buffer.deinit(h.alloc);
    h.link_buffer = .empty;
    h.kitty_placements.deinit(h.alloc);
    h.kitty_placements = .empty;
    h.has_render_data = false;
    h.render_update_count = 0;
    h.render_reset_count +%= 1;
}

pub export fn restty_render_compact(handle: ?*Restty) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    _ = h.buffers.compactCapacity(h.alloc, h.rows, h.cols) catch
        return @intFromEnum(ErrorCode.out_of_memory);
    if (h.glyphs) |table| {
        if (table.offsets.items.len > max_glyphs_after_compact) releaseGlyphTable(h);
    }
    releaseLineScratch(h);
    h.render_state.deinit(h.alloc);
    h.render_state = .empty;
    h.has_render_data = false;
    h.render_update_count = 0;
    h.render_reset_count +%= 1;
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_cells_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return switch (h.buffers.format) {
        .soa => @intFromPtr(h.buffers.codepoints.ptr),
        .gpu => @intFromPtr(h.buffers.records.ptr),
    };
}

pub export fn restty_cells_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.buffers.cell_capacity);
}

pub export fn restty_cell_capacity(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.buffers.cell_capacity);
}

/// Bytes per GPU cell record (four little-endian u32 words).
pub export fn restty_gpu_cell_stride() u32 {
    return @intCast(gpu_cell_bytes);
}

/// First byte of the `rows * cols` GPU records written by the last update, or
/// 0 when the GPU format has no buffer (not selected, never updated, released).
pub export fn restty_gpu_cells_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    if (h.buffers.format != .gpu or h.buffers.records.len == 0) return 0;
    return @intFromPtr(h.buffers.records.ptr);
}

/// 1 when at least one row's records changed in the last update (always 1
/// after full damage).
pub export fn restty_gpu_any_dirty(handle: ?*Restty) u32 {
    const h = handle orelse return 1;
    return h.gpu_any_dirty;
}

/// Glyph-id epoch. When it differs from the value a consumer last saw, every
/// previously received glyph id is invalid; the next update also reports full
/// damage and `restty_gpu_new_glyphs_*` then lists the complete new table.
pub export fn restty_gpu_epoch(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.gpu_epoch;
}

/// Visible cells with the blink attribute and a drawn glyph.
pub export fn restty_gpu_blinking_cells(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.gpu_blinking_cells;
}

/// Glyph ids interned in the current epoch (ids are 1..=count).
pub export fn restty_gpu_glyph_count(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return if (h.glyphs) |table| table.count() else 0;
}

/// Cells drawn as glyph 0 because the visible glyph set exceeded the table.
pub export fn restty_gpu_glyph_overflow(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.gpu_glyph_overflow;
}

/// Glyph records interned since the last `restty_gpu_glyphs_ack`, as
/// `[id][style][codepoint_count][codepoints...]` u32 words. The pointer is
/// valid until the next update, ack, release or compaction.
pub export fn restty_gpu_new_glyphs_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    const table = h.glyphs orelse return 0;
    if (table.pending_start >= table.stream.items.len) return 0;
    return @intFromPtr(table.stream.items.ptr + table.pending_start);
}

pub export fn restty_gpu_new_glyphs_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const table = h.glyphs orelse return 0;
    return @intCast(table.stream.items.len - table.pending_start);
}

/// Marks every glyph interned so far as delivered.
pub export fn restty_gpu_glyphs_ack(handle: ?*Restty) void {
    const h = handle orelse return;
    if (h.glyphs) |table| table.acknowledge();
}

/// The complete glyph table of the current epoch in the same record format
/// (for a consumer that must rebuild its id map without a full repaint).
pub export fn restty_gpu_glyphs_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    const table = h.glyphs orelse return 0;
    return if (table.stream.items.len == 0) 0 else @intFromPtr(table.stream.items.ptr);
}

pub export fn restty_gpu_glyphs_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    const table = h.glyphs orelse return 0;
    return @intCast(table.stream.items.len);
}

/// Decodes screen lines `first_line..=last_line` (absolute, scrollback
/// included) straight from the page list without moving the viewport or
/// touching the render state, in either render format. Output words, per line:
/// `[wrap_continuation]` then per column `[n][n codepoints]` where n = 0 for a
/// wide-character spacer, 1 + extras for a grapheme cluster, and a blank cell
/// is one space.
pub export fn restty_line_cells_prepare(handle: ?*Restty, first_line: u32, last_line: u32) u32 {
    const h = handle orelse return @intFromEnum(ErrorCode.invalid_handle);
    if (last_line < first_line) return @intFromEnum(ErrorCode.invalid_arg);
    const screen = h.term.screens.active;
    const total = screen.pages.scrollbar().total;
    if (first_line >= total) return @intFromEnum(ErrorCode.invalid_arg);
    const last = @min(last_line, @as(u32, @intCast(total - 1)));

    if (h.line_cells.capacity > max_retained_line_words) releaseLineScratch(h);
    h.line_cells.clearRetainingCapacity();

    const first_pin = pinForBufferPoint(screen, first_line, 0) orelse
        return @intFromEnum(ErrorCode.invalid_arg);
    const last_pin = pinForBufferPoint(screen, last, 0) orelse
        return @intFromEnum(ErrorCode.invalid_arg);

    var rows = first_pin.rowIterator(.right_down, last_pin);
    while (rows.next()) |pin| {
        const cells = pin.cells(.all);
        h.line_cells.ensureUnusedCapacity(h.alloc, 1 + cells.len * 2) catch
            return @intFromEnum(ErrorCode.out_of_memory);
        h.line_cells.appendAssumeCapacity(@intFromBool(pin.rowAndCell().row.wrap_continuation));
        for (cells) |*cell| {
            switch (cell.wide) {
                .spacer_tail, .spacer_head => {
                    h.line_cells.appendAssumeCapacity(0);
                    continue;
                },
                .narrow, .wide => {},
            }
            const codepoint: u32 = cell.codepoint();
            const is_kitty_placeholder = if (comptime kitty_graphics_enabled)
                codepoint == ghostty.kitty.graphics.unicode.placeholder
            else
                false;
            const extras: []const u21 = if (cell.hasGrapheme() and !is_kitty_placeholder)
                pin.grapheme(cell) orelse &.{}
            else
                &.{};
            h.line_cells.ensureUnusedCapacity(h.alloc, 1 + extras.len) catch
                return @intFromEnum(ErrorCode.out_of_memory);
            h.line_cells.appendAssumeCapacity(@intCast(1 + extras.len));
            h.line_cells.appendAssumeCapacity(if (codepoint == 0) ' ' else codepoint);
            for (extras) |cp| h.line_cells.appendAssumeCapacity(cp);
        }
    }
    return @intFromEnum(ErrorCode.ok);
}

pub export fn restty_line_cells_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.line_cells.items.len == 0) 0 else @intFromPtr(h.line_cells.items.ptr);
}

pub export fn restty_line_cells_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.line_cells.items.len);
}

pub export fn restty_line_cells_release(handle: ?*Restty) void {
    const h = handle orelse return;
    if (h.line_cells.capacity > max_retained_line_words) releaseLineScratch(h);
}

pub export fn restty_row_capacity(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.buffers.row_dirty.len);
}

pub export fn restty_render_reset_count(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.render_reset_count;
}

pub export fn restty_cell_codepoints_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.codepoints.ptr);
}

pub export fn restty_cell_content_tags_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.content_tags.ptr);
}

pub export fn restty_cell_wide_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.wide.ptr);
}

pub export fn restty_cell_flags_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.flags.ptr);
}

pub export fn restty_cell_style_flags_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.style_flags.ptr);
}

pub export fn restty_cell_underline_styles_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.underline_styles.ptr);
}

pub export fn restty_cell_link_ids_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.link_ids.ptr);
}

pub export fn restty_cell_fg_rgba_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.fg_rgba.ptr);
}

pub export fn restty_cell_bg_rgba_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.bg_rgba.ptr);
}

pub export fn restty_cell_ul_rgba_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.ul_rgba.ptr);
}

pub export fn restty_link_offsets_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.link_offsets.items.len == 0) 0 else @intFromPtr(h.link_offsets.items.ptr);
}

pub export fn restty_link_lengths_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.link_lengths.items.len == 0) 0 else @intFromPtr(h.link_lengths.items.ptr);
}

pub export fn restty_link_buffer_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.link_buffer.items.len == 0) 0 else @intFromPtr(h.link_buffer.items.ptr);
}

pub export fn restty_link_count(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.link_offsets.items.len);
}

pub export fn restty_link_buffer_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.link_buffer.items.len);
}

pub export fn restty_cell_grapheme_offsets_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.grapheme_offsets.ptr);
}

pub export fn restty_cell_grapheme_lengths_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.grapheme_lengths.ptr);
}

pub export fn restty_grapheme_buffer_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.graphemes.items.len == 0) 0 else @intFromPtr(h.graphemes.items.ptr);
}

pub export fn restty_grapheme_buffer_len(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.graphemes.items.len);
}

pub export fn restty_row_selection_start_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.row_selection_start.ptr);
}

pub export fn restty_row_selection_end_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.row_selection_end.ptr);
}

pub export fn restty_row_wrapped_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.row_wrapped.ptr);
}

pub export fn restty_row_dirty_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(h.buffers.row_dirty.ptr);
}

pub export fn restty_damage_full(handle: ?*Restty) u32 {
    const h = handle orelse return 1;
    return h.damage_full;
}

pub export fn restty_cursor_info_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return @intFromPtr(&h.cursor);
}

pub export fn restty_rows(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.rows;
}

pub export fn restty_cols(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.cols;
}

pub export fn restty_active_cursor_x(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.term.screens.active.cursor.x);
}

pub export fn restty_active_cursor_y(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.term.screens.active.cursor.y);
}

pub export fn restty_debug_scroll_left(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.term.scrolling_region.left);
}

pub export fn restty_debug_scroll_right(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.term.scrolling_region.right);
}

pub export fn restty_debug_term_cols(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.cols;
}

pub export fn restty_debug_term_rows(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.rows;
}

pub export fn restty_debug_page_cols(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.screens.active.pages.cols;
}

pub export fn restty_debug_page_rows(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return h.term.screens.active.pages.rows;
}

pub export fn restty_kitty_placement_stride() u32 {
    return @sizeOf(KittyPlacementAbi);
}

pub export fn restty_kitty_placement_count(handle: ?*Restty) u32 {
    const h = handle orelse return 0;
    return @intCast(h.kitty_placements.items.len);
}

pub export fn restty_kitty_placements_ptr(handle: ?*Restty) usize {
    const h = handle orelse return 0;
    return if (h.kitty_placements.items.len == 0) 0 else @intFromPtr(h.kitty_placements.items.ptr);
}

pub export fn restty_alloc(len: usize) usize {
    if (len == 0) return 0;
    const buf = std.heap.wasm_allocator.alloc(u8, len) catch return 0;
    return @intFromPtr(buf.ptr);
}

pub export fn restty_free(ptr: usize, len: usize) void {
    if (ptr == 0 or len == 0) return;
    const buf = @as([*]u8, @ptrFromInt(ptr));
    std.heap.wasm_allocator.free(buf[0..len]);
}
