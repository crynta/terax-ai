import { Button } from "@/components/ui/button";
import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState, useRef } from "react";

type Props = {
  path: string;
  size: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function getFilename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function ImageViewer({ path, size }: Props) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleZoomIn = () => setScale((s) => Math.min(5, s + 0.25));
  const handleZoomOut = () => setScale((s) => Math.max(0.25, s - 0.25));
  const handleZoomReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setDimensions({ width: naturalWidth, height: naturalHeight });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const nextX = e.clientX - dragStartRef.current.x;
    const nextY = e.clientY - dragStartRef.current.y;
    setPosition({ x: nextX, y: nextY });
  };

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // e.deltaY < 0 means scroll up (zoom in), e.deltaY > 0 means scroll down (zoom out)
    const zoomStep = 0.1;
    setScale((s) => {
      if (e.deltaY < 0) {
        return Math.min(5, s + zoomStep);
      } else {
        return Math.max(0.25, s - zoomStep);
      }
    });
  };

  const filename = getFilename(path);
  const src = convertFileSrc(path);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-muted/20 select-none">
      {/* Viewport container */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center min-h-0">
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          className="relative h-full w-full flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: "conic-gradient(rgba(128,128,128,0.08) 25%, transparent 0 50%, rgba(128,128,128,0.08) 0 75%, transparent 0)",
            backgroundSize: "16px 16px",
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={filename}
            onLoad={handleImageLoad}
            className="max-h-[85vh] max-w-[85vw] object-contain select-none pointer-events-none transition-transform duration-75 ease-out origin-center"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            }}
          />
        </div>
      </div>

      {/* Floating premium glassmorphic control bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 px-4 py-2.5 rounded-full border border-border/45 bg-background/70 backdrop-blur-md shadow-lg transition-all duration-200 hover:bg-background/80 hover:shadow-xl z-10">
        <div className="flex items-center gap-2 border-r border-border/40 pr-3">
          <HugeiconsIcon
            icon={Image01Icon}
            size={15}
            strokeWidth={2}
            className="text-muted-foreground shrink-0"
          />
          <div className="flex flex-col min-w-0 max-w-[160px]">
            <span
              title={filename}
              className="text-[11px] font-medium text-foreground truncate leading-tight cursor-help"
            >
              {filename}
            </span>
            <span className="text-[9.5px] text-muted-foreground leading-none mt-0.5">
              {formatBytes(size)}
            </span>
          </div>
        </div>

        {dimensions && (
          <div className="text-[10px] font-mono text-muted-foreground border-r border-border/40 pr-3 h-4 flex items-center leading-none">
            {dimensions.width} × {dimensions.height} px
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            disabled={scale <= 0.25}
            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground flex items-center justify-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Zoom Out</title>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </Button>

          <button
            type="button"
            onClick={handleZoomReset}
            className="text-[10px] font-mono font-medium min-w-[36px] text-center px-1.5 py-0.5 rounded hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-colors"
          >
            {Math.round(scale * 100)}%
          </button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            disabled={scale >= 5}
            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground flex items-center justify-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Zoom In</title>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
