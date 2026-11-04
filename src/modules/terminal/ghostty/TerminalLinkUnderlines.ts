import type {
  TerminalDamage,
  TerminalRowRange,
} from "@/modules/terminal/backend/contracts";
import type { GhosttyTerminalModelApi } from "./GhosttyTerminalModel";

type LinkCellsModel = Pick<GhosttyTerminalModelApi, "linkCellsInRows">;

/**
 * Which visible cells belong to a link, so surfaces can underline every link,
 * not only the hovered one. Only rows whose content changed are rescanned
 * (widened to whole wrapped lines, since a link can span them); `update`
 * returns the rows whose link cells changed, including rows outside the
 * damage, such as the tail of a wrapped link whose head was rewritten.
 */
export class TerminalLinkUnderlines {
  private rows = 0;
  private cols = 0;
  private mask = new Uint8Array(0);
  private rowLinks = new Uint16Array(0);

  update(
    model: LinkCellsModel,
    rows: number,
    cols: number,
    ranges: readonly TerminalRowRange[],
  ): TerminalRowRange[] {
    if (!model.linkCellsInRows) return [];
    if (rows !== this.rows || cols !== this.cols) {
      this.rows = rows;
      this.cols = cols;
      this.mask = new Uint8Array(rows * cols);
      this.rowLinks = new Uint16Array(rows);
    }
    const changed: number[] = [];
    let scannedTo = -1;
    for (const range of ranges) {
      if (range.end <= scannedTo) continue;
      const result = model.linkCellsInRows(
        Math.max(range.start, scannedTo + 1),
        range.end,
      );
      if (result.end < result.start) continue;
      scannedTo = result.end;
      const next = new Uint8Array((result.end - result.start + 1) * cols);
      for (const span of result.spans) {
        const base = (span.row - result.start) * cols;
        next.fill(1, base + span.start, base + span.end + 1);
      }
      for (let row = result.start; row <= result.end; row++) {
        const offset = (row - result.start) * cols;
        const current = this.mask.subarray(row * cols, (row + 1) * cols);
        const fresh = next.subarray(offset, offset + cols);
        if (current.every((value, index) => value === fresh[index])) continue;
        current.set(fresh);
        let count = 0;
        for (const value of fresh) count += value;
        this.rowLinks[row] = count;
        changed.push(row);
      }
    }
    return coalesceRows(changed);
  }

  isLink(row: number, column: number): boolean {
    return this.mask[row * this.cols + column] === 1;
  }

  rowHasLinks(row: number): boolean {
    return row < this.rows && this.rowLinks[row] > 0;
  }

  reset(): void {
    this.rows = 0;
    this.cols = 0;
    this.mask = new Uint8Array(0);
    this.rowLinks = new Uint16Array(0);
  }
}

/** The rows `damage` covers, for a viewport of `rows` rows. */
export function damagedRows(
  damage: TerminalDamage,
  rows: number,
): readonly TerminalRowRange[] {
  if (damage.kind === "none" || rows === 0) return [];
  if (damage.kind === "full") return [{ start: 0, end: rows - 1 }];
  return damage.ranges;
}

/** `damage` widened by `extra` rows (rows whose link underlines changed). */
export function damageWithRows(
  damage: TerminalDamage,
  extra: readonly TerminalRowRange[],
): TerminalDamage {
  if (extra.length === 0 || damage.kind === "full") return damage;
  const ranges =
    damage.kind === "rows" ? [...damage.ranges, ...extra] : [...extra];
  const merged: TerminalRowRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      };
    } else {
      merged.push(range);
    }
  }
  return { kind: "rows", ranges: merged };
}

function coalesceRows(rows: readonly number[]): TerminalRowRange[] {
  const sorted = [...rows].sort((a, b) => a - b);
  const ranges: TerminalRowRange[] = [];
  for (const row of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && row <= last.end + 1) {
      ranges[ranges.length - 1] = {
        start: last.start,
        end: Math.max(last.end, row),
      };
    } else {
      ranges.push({ start: row, end: row });
    }
  }
  return ranges;
}
