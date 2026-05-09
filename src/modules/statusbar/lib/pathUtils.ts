export type Segment = {
  label: string;
  fullPath: string;
  isHome: boolean;
};

export function segmentsFromCwd(cwd: string, home: string | null): Segment[] {
  const usingHome =
    home !== null && (cwd === home || cwd.startsWith(home + "/"));
  const tail = usingHome
    ? cwd.slice(home.length).replace(/^\//, "")
    : cwd.replace(/^\//, "");
  const parts = tail === "" ? [] : tail.split("/").filter(Boolean);

  const segments: Segment[] = [];
  if (usingHome) {
    segments.push({ label: "~", fullPath: home, isHome: true });
  } else {
    segments.push({ label: "/", fullPath: "/", isHome: false });
  }

  let acc = segments[0].fullPath;
  for (const part of parts) {
    acc = acc === "/" ? `/${part}` : `${acc}/${part}`;
    segments.push({ label: part, fullPath: acc, isHome: false });
  }
  return segments;
}
