import {
  DEFAULT_SPACE_ID,
  type Tab,
  type TerminalTab,
} from "@/modules/tabs/lib/useTabs";
import type { AgentPhase } from "@/modules/terminal/lib/agentActivity";
import { findLeafCwd, hasLeaf, leafIds } from "@/modules/terminal/lib/panes";
import type {
  AgentNotification,
  AgentSession,
  NotificationKind,
} from "./types";

export type SessionPhase = AgentPhase;

/** One agent session as the Sessions sidebar and command palette show it. */
export type SessionRow = {
  leafId: number;
  tabId: number;
  /** The space the session's tab belongs to. */
  spaceId: string;
  agent: string;
  phase: SessionPhase;
  /** Custom tab title, else the tab's title, else the cwd's folder name. */
  title: string;
  /** "Pane 2" when the tab is split, so sibling sessions stay distinguishable. */
  paneLabel: string | null;
  cwd: string | null;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
  /** Claude Code session id, for opening its transcript in the Reader. */
  claudeSessionId: string | null;
  lastNotification: { kind: NotificationKind; at: number } | null;
};

export type SessionRowsInput = {
  sessions: Record<number, AgentSession>;
  phases: Record<number, AgentPhase>;
  sessionIds: Record<number, string>;
  notifications: readonly AgentNotification[];
  tabs: readonly Tab[];
  ptyIdForLeaf: (leafId: number) => number | null;
};

const PHASE_RANK: Record<SessionPhase, number> = {
  attention: 0,
  working: 1,
  finished: 2,
  idle: 3,
};

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed || path;
}

/**
 * Joins the agent sessions with their tabs, live phases and latest
 * notification, sorted so sessions needing input come first, then working,
 * then finished and idle; most recent first within each group. Sessions whose
 * tab has closed are dropped.
 */
export function selectSessionRows(input: SessionRowsInput): SessionRow[] {
  const terminalTabs = new Map<number, TerminalTab>();
  for (const tab of input.tabs) {
    if (tab.kind === "terminal") terminalTabs.set(tab.id, tab);
  }
  const latest = new Map<number, AgentNotification>();
  for (const n of input.notifications) {
    const prev = latest.get(n.leafId);
    if (!prev || n.at > prev.at) latest.set(n.leafId, n);
  }

  const rows: SessionRow[] = [];
  for (const session of Object.values(input.sessions)) {
    const tab = terminalTabs.get(session.tabId);
    // A closed pane of a tab that is still open leaves no row behind.
    if (!tab || !hasLeaf(tab.paneTree, session.leafId)) continue;
    const ptyId = input.ptyIdForLeaf(session.leafId);
    // Without a live phase nothing tracks the agent any more, so it is never
    // shown as working.
    const phase =
      (ptyId !== null ? input.phases[ptyId] : undefined) ??
      (session.status === "waiting" ? "attention" : "idle");
    const cwd = findLeafCwd(tab.paneTree, session.leafId) ?? tab.cwd ?? null;
    const leaves = leafIds(tab.paneTree);
    const index = leaves.indexOf(session.leafId);
    const note = latest.get(session.leafId);
    rows.push({
      leafId: session.leafId,
      tabId: session.tabId,
      spaceId: tab.spaceId || DEFAULT_SPACE_ID,
      agent: session.agent,
      phase,
      title:
        tab.customTitle?.trim() ||
        tab.title?.trim() ||
        (cwd ? basename(cwd) : "") ||
        session.agent,
      paneLabel: leaves.length > 1 && index >= 0 ? `Pane ${index + 1}` : null,
      cwd,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      attentionSince: session.attentionSince,
      claudeSessionId:
        session.claudeSessionId ??
        (ptyId !== null ? input.sessionIds[ptyId] : undefined) ??
        null,
      lastNotification: note ? { kind: note.kind, at: note.at } : null,
    });
  }
  return rows.sort(compareRows);
}

function compareRows(a: SessionRow, b: SessionRow): number {
  const rank = PHASE_RANK[a.phase] - PHASE_RANK[b.phase];
  if (rank !== 0) return rank;
  const recency =
    a.phase === "attention"
      ? (b.attentionSince ?? b.lastActivityAt) -
        (a.attentionSince ?? a.lastActivityAt)
      : b.lastActivityAt - a.lastActivityAt;
  return recency !== 0 ? recency : a.leafId - b.leafId;
}

/** How many sessions are waiting on the user, for the sidebar rail badge. */
export function countNeedingInput(rows: readonly SessionRow[]): number {
  let count = 0;
  for (const row of rows) if (row.phase === "attention") count += 1;
  return count;
}

/** The fields of a space the sidebar groups by. */
export type SpaceInfo = { id: string; name: string; color?: number };

/** The sessions of one space, as the sidebar shows them. */
export type SpaceGroup = {
  spaceId: string;
  name: string;
  color?: number;
  /** The space on screen now. */
  current: boolean;
  /** Sorted as `selectSessionRows` sorts them. */
  rows: SessionRow[];
  attention: number;
  working: number;
};

/**
 * `rows` grouped by space: the current space first, then the others in the
 * order the space switcher lists them; spaces without sessions are left out.
 */
export function groupRowsBySpace(
  rows: readonly SessionRow[],
  spaces: readonly SpaceInfo[],
  activeId: string | null,
): SpaceGroup[] {
  const current = activeId ?? DEFAULT_SPACE_ID;
  const known = new Map(spaces.map((space) => [space.id, space]));
  const groups = new Map<string, SpaceGroup>();
  for (const row of rows) {
    let group = groups.get(row.spaceId);
    if (!group) {
      const space = known.get(row.spaceId);
      group = {
        spaceId: row.spaceId,
        name: space?.name ?? "Other",
        color: space?.color,
        current: row.spaceId === current,
        rows: [],
        attention: 0,
        working: 0,
      };
      groups.set(row.spaceId, group);
    }
    group.rows.push(row);
    if (row.phase === "attention") group.attention += 1;
    if (row.phase === "working") group.working += 1;
  }
  const order = new Map(spaces.map((space, index) => [space.id, index]));
  const rank = (group: SpaceGroup) =>
    group.current ? -1 : (order.get(group.spaceId) ?? spaces.length);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
