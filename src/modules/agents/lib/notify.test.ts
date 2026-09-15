import { beforeEach, describe, expect, it, vi } from "vitest";

const notification = vi.hoisted(() => ({
  isPermissionGranted: vi.fn<() => Promise<boolean>>(),
  requestPermission: vi.fn<() => Promise<"granted" | "denied">>(),
  sendNotification: vi.fn(),
}));
const sound = vi.hoisted(() => ({
  playAgentNotificationSound: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notification);
vi.mock("./sound", () => sound);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  notification.isPermissionGranted.mockResolvedValue(true);
  notification.requestPermission.mockResolvedValue("granted");
});

describe("osNotify", () => {
  it("requests a native notification when permission is available", async () => {
    const { osNotify } = await import("./notify");

    await expect(osNotify("Title", "Body")).resolves.toBe("requested");
    expect(notification.sendNotification).toHaveBeenCalledWith({
      title: "Title",
      body: "Body",
    });
  });

  it("does not send when permission is denied", async () => {
    notification.isPermissionGranted.mockResolvedValue(false);
    notification.requestPermission.mockResolvedValue("denied");
    const { osNotify } = await import("./notify");

    await expect(osNotify("Title", "Body")).resolves.toBe("denied");
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });

  it("reports a synchronous request failure", async () => {
    notification.sendNotification.mockImplementation(() => {
      throw new Error("unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { osNotify } = await import("./notify");

    await expect(osNotify("Title", "Body")).resolves.toBe("failed");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("testAgentOsNotification", () => {
  it("plays the notification sound after requesting the native alert", async () => {
    const { testAgentOsNotification } = await import("./notify");

    await expect(testAgentOsNotification()).resolves.toBe("requested");
    expect(sound.playAgentNotificationSound).toHaveBeenCalledOnce();
  });

  it("keeps a native test silent when sound is disabled", async () => {
    const { testAgentOsNotification } = await import("./notify");

    await expect(testAgentOsNotification(false)).resolves.toBe("requested");
    expect(sound.playAgentNotificationSound).not.toHaveBeenCalled();
  });
});
