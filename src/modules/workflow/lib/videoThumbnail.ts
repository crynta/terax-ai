/**
 * Video thumbnail extraction using browser canvas.
 * Draws the first frame of a video onto a canvas to produce a poster image.
 * Works in both Tauri webview and browser contexts — no ffmpeg needed.
 */

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_QUALITY = 0.7;

/**
 * Extract a thumbnail from a video URL at the given time offset.
 * Returns a data URL (image/jpeg) or null if extraction fails.
 */
export async function extractVideoThumbnail(
  videoSrc: string,
  timeOffsetSec = 1,
): Promise<string | null> {
  return new Promise((resolve) => {
    const video = globalThis.document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    function cleanup() {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      video.removeEventListener("seeked", onSeeked);
      video.src = "";
      video.load();
    }

    function onLoaded() {
      // Seek to offset (default 1s to skip black frames)
      // Handle zero/invalid duration
      if (
        !video.duration ||
        !Number.isFinite(video.duration) ||
        video.duration < 0.1
      ) {
        // Very short or unknown duration — seek to start
        video.currentTime = 0;
      } else {
        video.currentTime = Math.min(timeOffsetSec, video.duration * 0.1);
      }
    }

    function onSeeked() {
      try {
        const canvas = globalThis.document.createElement("canvas");
        const scale = THUMBNAIL_WIDTH / video.videoWidth;
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = Math.round(video.videoHeight * scale);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY);
        cleanup();
        resolve(dataUrl);
      } catch {
        cleanup();
        resolve(null);
      }
    }

    function onError() {
      cleanup();
      resolve(null);
    }

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.src = videoSrc;
    video.load();
  });
}

/**
 * Extract multiple thumbnails at evenly spaced intervals.
 * Returns up to `count` data URLs.
 */
export async function extractVideoStoryboard(
  videoSrc: string,
  count = 4,
): Promise<string[]> {
  return new Promise((resolve) => {
    const video = globalThis.document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const timeout = setTimeout(() => {
      cleanup();
      resolve(thumbnails);
    }, 10000);

    const thumbnails: string[] = [];
    let currentFrame = 0;

    function cleanup() {
      clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onError);
      video.removeEventListener("seeked", onSeeked);
      video.src = "";
      video.load();
    }

    function onMeta() {
      if (!video.duration || !Number.isFinite(video.duration)) {
        cleanup();
        resolve([]);
        return;
      }
      // Start extracting from 10% in to skip potential black frames
      seekNext();
    }

    function seekNext() {
      if (currentFrame >= count) {
        cleanup();
        resolve(thumbnails);
        return;
      }
      const fraction = 0.1 + (currentFrame / count) * 0.8;
      video.currentTime = video.duration * fraction;
    }

    function onSeeked() {
      try {
        const canvas = globalThis.document.createElement("canvas");
        const thumbW = 160;
        const scale = thumbW / video.videoWidth;
        canvas.width = thumbW;
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          thumbnails.push(canvas.toDataURL("image/jpeg", 0.5));
        }
      } catch {
        // Skip frame
      }
      currentFrame++;
      seekNext();
    }

    function onError() {
      cleanup();
      resolve(thumbnails);
    }

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.src = videoSrc;
    video.load();
  });
}
