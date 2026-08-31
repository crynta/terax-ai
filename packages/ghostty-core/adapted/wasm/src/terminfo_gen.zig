const std = @import("std");
const terminfo = @import("ghostty-terminfo");

pub fn main(init: std.process.Init) !void {
    var buffer: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writerStreaming(init.io, &buffer);
    const writer = &stdout.interface;
    try writer.writeAll(
        \\const std = @import("std");
        \\pub const map = std.StaticStringMap([]const u8).initComptime(&.{
        \\
    );

    const source = comptime terminfo.ghostty.xtgettcapMap();
    for (source.keys(), source.values()) |key, value| {
        try writer.print(
            "    .{{ \"{f}\", \"{f}\" }},\n",
            .{ std.zig.fmtString(key), std.zig.fmtString(value) },
        );
    }
    try writer.writeAll("});\n");
    try stdout.end();
}
