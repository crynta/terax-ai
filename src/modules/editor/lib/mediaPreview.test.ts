import { describe, expect, it } from "vitest";
import { mediaPreviewKind } from "./mediaPreview";

describe("mediaPreviewKind", () => {
  it("detects video types", () => {
    expect(mediaPreviewKind("movie.mp4")).toBe("video");
    expect(mediaPreviewKind("clip.webm")).toBe("video");
    expect(mediaPreviewKind("video.mov")).toBe("video");
    expect(mediaPreviewKind("film.ogg")).toBe("video");
  });

  it("detects audio types", () => {
    expect(mediaPreviewKind("song.mp3")).toBe("audio");
    expect(mediaPreviewKind("track.wav")).toBe("audio");
    expect(mediaPreviewKind("audio.flac")).toBe("audio");
    expect(mediaPreviewKind("file.aac")).toBe("audio");
    expect(mediaPreviewKind("file.m4a")).toBe("audio");
  });

  it("detects image and pdf", () => {
    expect(mediaPreviewKind("img.png")).toBe("image");
    expect(mediaPreviewKind("photo.jpg")).toBe("image");
    expect(mediaPreviewKind("doc.pdf")).toBe("pdf");
  });

  it("returns null for text files", () => {
    expect(mediaPreviewKind("readme.md")).toBeNull();
    expect(mediaPreviewKind("script.ts")).toBeNull();
    expect(mediaPreviewKind("config.json")).toBeNull();
  });
});
