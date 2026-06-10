/**
 * Tests for the pending tool-approval registry.
 *
 * When a session is stopped or deleted while a tool is awaiting approval, its
 * pending approval must be resolved immediately (as denied) rather than left
 * hanging until a silent timeout — otherwise a late approval could execute a
 * tool after the session was torn down.
 */
import { describe, expect, it, vi } from "vitest";
import { PendingApprovalRegistry } from "./approval-registry";

describe("PendingApprovalRegistry", () => {
  it("resolves a registered approval with the user's decision", () => {
    const registry = new PendingApprovalRegistry();
    const resolve = vi.fn();

    registry.add("s1", "call-1", resolve);
    const handled = registry.respond("s1", "call-1", true);

    expect(handled).toBe(true);
    expect(resolve).toHaveBeenCalledWith(true);
    // A second response for the same call is a no-op.
    expect(registry.respond("s1", "call-1", false)).toBe(false);
  });

  it("reports no pending approval for an unknown call", () => {
    const registry = new PendingApprovalRegistry();
    expect(registry.respond("s1", "ghost", true)).toBe(false);
  });

  it("clears a session's pending approvals as denied without touching others", () => {
    const registry = new PendingApprovalRegistry();
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    registry.add("s1", "call-a", a);
    registry.add("s1", "call-b", b);
    registry.add("s2", "call-c", other);

    registry.clearForSession("s1");

    expect(a).toHaveBeenCalledWith(false);
    expect(b).toHaveBeenCalledWith(false);
    expect(other).not.toHaveBeenCalled();
    // s1's approvals are gone; s2's remains.
    expect(registry.respond("s1", "call-a", true)).toBe(false);
    expect(registry.respond("s2", "call-c", true)).toBe(true);
  });
});
