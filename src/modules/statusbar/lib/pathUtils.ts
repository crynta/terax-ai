import type { WorkspaceEnv } from "@/modules/workspace";

export type Segment = {
  label: string;
  fullPath: string;
  isHome: boolean;
};

const WINDOWS_DRIVE = /^([A-Za-z]:)(.*)$/;

export function joinCanonicalChild(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

export function listSubdirsForEnv(
  list: (
    path: string,
    showHidden: boolean,
    env: WorkspaceEnv,
  ) => Promise<string[]>,
  path: string,
  showHidden: boolean,
  env: WorkspaceEnv,
): Promise<string[]> {
  return list(path, showHidden, env);
}

export type LatestRequestGate = {
  begin(): number;
  invalidate(): void;
  isCurrent(id: number): boolean;
};

export function createLatestRequestGate(): LatestRequestGate {
  let requestId = 0;
  return {
    begin: () => ++requestId,
    invalidate: () => {
      requestId += 1;
    },
    isCurrent: (id) => id === requestId,
  };
}

export function scrollBreadcrumbToEnd(target: {
  scrollLeft: number;
  scrollWidth: number;
}): void {
  target.scrollLeft = target.scrollWidth;
}

export function horizontalWheelDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
}

export function segmentsFromCwd(cwd: string, home: string | null): Segment[] {
  const normCwd = cwd;
  const normHome = home;

  let rootSegment: Segment;
  let tail: string;

  if (
    normHome !== null &&
    (normCwd === normHome || normCwd.startsWith(`${normHome}/`))
  ) {
    rootSegment = { label: "~", fullPath: normHome, isHome: true };
    tail = normCwd.slice(normHome.length).replace(/^\//, "");
  } else if (normCwd.startsWith("//")) {
    const [server, share, ...rest] = normCwd.slice(2).split("/");
    const uncRoot = `//${server}/${share}`;
    rootSegment = { label: uncRoot, fullPath: uncRoot, isHome: false };
    tail = rest.join("/");
  } else {
    const driveMatch = WINDOWS_DRIVE.exec(normCwd);
    if (driveMatch) {
      const drive = driveMatch[1];
      rootSegment = { label: drive, fullPath: `${drive}/`, isHome: false };
      tail = driveMatch[2].replace(/^\//, "");
    } else {
      rootSegment = { label: "/", fullPath: "/", isHome: false };
      tail = normCwd.replace(/^\//, "");
    }
  }

  const parts = tail === "" ? [] : tail.split("/").filter(Boolean);
  const segments: Segment[] = [rootSegment];

  let acc = rootSegment.fullPath;
  for (const part of parts) {
    acc = acc.endsWith("/") ? `${acc}${part}` : `${acc}/${part}`;
    segments.push({ label: part, fullPath: acc, isHome: false });
  }
  return segments;
}
