import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { guessMime } from "@/modules/media/lib/mime";

type Props = {
  path: string;
  mediaKind: "image" | "video" | "audio";
  visible: boolean;
};

export function MediaPane({ path, mediaKind, visible }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState<boolean | null>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }

    setSrc(null);
    setErrorMsg(null);
    setHasVideoTrack(null);

    const timer = setTimeout(() => {
      invoke<number[]>("fs_read_bytes", { path })
        .then((arr) => {
          if (!alive) return;
          const bytes = new Uint8Array(arr);
          const mime = guessMime(path, mediaKind);
          const blob = new Blob([bytes], { type: mime });
          const url = URL.createObjectURL(blob);
          blobRef.current = url;
          setSrc(url);
        })
        .catch((e) => {
          const msg = typeof e === "string" ? e : String(e);
          if (alive) setErrorMsg(msg);
        });
    }, 50);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path, mediaKind]);

  // Called when <video> fires loadedmetadata — check if there's actually a
  // video track. Some .mp4 / .mov files are audio-only containers.
  const handleVideoMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const el = e.currentTarget;
      // videoWidth > 0 means a decoded video frame exists.
      setHasVideoTrack(el.videoWidth > 0 && el.videoHeight > 0);
    },
    [],
  );

  if (!visible) {
    return <div className="hidden h-full w-full" aria-hidden />;
  }

  if (errorMsg) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2">
        <p className="text-[12px] text-muted-foreground">Failed to load media</p>
        <p className="max-w-md px-4 text-center text-[11px] text-muted-foreground/70">
          {errorMsg}
        </p>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-[12px] text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Image
  if (mediaKind === "image") {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-background/50 p-4">
        <img
          src={src}
          alt={path}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  // Video — might be audio-only; detect on metadata load
  if (mediaKind === "video") {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-background/50 p-4">
        {/* Hidden probe: load metadata to detect video track */}
        {hasVideoTrack === null && (
          <video
            src={src}
            onLoadedMetadata={handleVideoMetadata}
            className="hidden"
          />
        )}
        {hasVideoTrack === true && (
          <video src={src} controls className="max-h-full max-w-full" />
        )}
        {hasVideoTrack === false && (
          <AudioPlayer src={src} />
        )}
      </div>
    );
  }

  // Audio
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-background/50 p-4">
      <AudioPlayer src={src} />
    </div>
  );
}

// --- Audio Player ----------------------------------------------------------

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(e.target.value);
    el.currentTime = t;
    setCurrent(t);
  }, []);

  const changeVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const v = Number(e.target.value);
    el.volume = v;
    setVolume(v);
  }, []);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-lg bg-card/80 p-4 shadow-sm">
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          // Throttle: only update every ~250ms to avoid excessive re-renders.
          const t = e.currentTarget.currentTime;
          setCurrent((prev) => (Math.abs(t - prev) < 0.25 ? prev : t));
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />

      {/* Seek bar */}
      <div className="flex w-full items-center gap-2">
        <span className="w-10 text-right text-[10px] text-muted-foreground tabular-nums">
          {fmtTime(current)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={seek}
          className="h-1 w-full cursor-pointer accent-primary"
        />
        <span className="w-10 text-[10px] text-muted-foreground tabular-nums">
          {fmtTime(duration)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex w-full items-center justify-between">
        {/* Play/Pause */}
        <button
          type="button"
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="3.5" height="12" rx="1" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 1.5v11l9-5.5z" />
            </svg>
          )}
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            {volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
            {volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
          </svg>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={changeVolume}
            className="h-1 w-16 cursor-pointer accent-primary"
          />
        </div>
      </div>
    </div>
  );
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
