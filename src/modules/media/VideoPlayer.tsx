import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MaximizeScreenIcon,
  MinimizeScreenIcon,
  PauseIcon,
  PlayIcon,
  VolumeHighIcon,
  VolumeMute01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  mime: string;
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({ src, mime }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // The native settings menu is unreliable on WebKitGTK, so playbackRate is
  // driven directly here. Re-applied on load because some backends reset it.
  const applyRate = useCallback((r: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
  }, []);
  useEffect(() => {
    applyRate(rate);
  }, [rate, src, applyRate]);

  useEffect(() => {
    const onFs = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  };

  return (
    <div
      ref={containerRef}
      className="group relative flex h-full w-full items-center justify-center bg-black/40"
      // Kill the webview's default right-click menu — it looks foreign.
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          applyRate(rate);
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        className="max-h-full max-w-full object-contain block"
      >
        <source src={src} type={mime} />
      </video>

      {/* Custom control bar — replaces native controls so there is no native
          settings gear or context menu. Visible on hover and while paused. */}
      <div
        className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white transition-opacity duration-150 ${
          playing ? "opacity-0 group-hover:opacity-100" : "opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={togglePlay}
          className="shrink-0 rounded p-1 hover:bg-white/15"
          title={playing ? "Pause" : "Play"}
        >
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={18} />
        </button>

        <span className="shrink-0 tabular-nums text-[11px] text-white/90">
          {fmt(current)} / {fmt(duration)}
        </span>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step="any"
          value={current}
          onChange={(e) => {
            const v = videoRef.current;
            const next = Number(e.target.value);
            if (v) v.currentTime = next;
            setCurrent(next);
          }}
          className="h-1 flex-1 cursor-pointer accent-primary"
          title="Seek"
        />

        <button
          type="button"
          onClick={toggleMute}
          className="shrink-0 rounded p-1 hover:bg-white/15"
          title={muted ? "Unmute" : "Mute"}
        >
          <HugeiconsIcon
            icon={muted || volume === 0 ? VolumeMute01Icon : VolumeHighIcon}
            size={18}
          />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = videoRef.current;
            const next = Number(e.target.value);
            if (v) {
              v.volume = next;
              v.muted = next === 0;
            }
          }}
          className="h-1 w-16 shrink-0 cursor-pointer accent-primary"
          title="Volume"
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums hover:bg-white/15"
            title="Playback speed"
          >
            {rate}×
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-24">
            <DropdownMenuRadioGroup
              value={String(rate)}
              onValueChange={(val) => {
                const r = Number(val);
                setRate(r);
                applyRate(r);
              }}
            >
              {SPEEDS.map((s) => (
                <DropdownMenuRadioItem key={s} value={String(s)}>
                  {s}×
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="shrink-0 rounded p-1 hover:bg-white/15"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          <HugeiconsIcon
            icon={isFullscreen ? MinimizeScreenIcon : MaximizeScreenIcon}
            size={18}
          />
        </button>
      </div>
    </div>
  );
}
