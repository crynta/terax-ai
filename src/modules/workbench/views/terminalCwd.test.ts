import { beforeEach, expect, it, vi } from "vitest";
import { native } from "@/modules/ai/lib/native";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { useWorkbench } from "../store";
import { reportCwd } from "./terminalCwd";

vi.mock("@/modules/ai/lib/native", () => ({
  native: { workspaceAuthorize: vi.fn().mockResolvedValue("") },
}));

beforeEach(() => {
  vi.mocked(native.workspaceAuthorize).mockClear();
  useSpaces.setState({
    spaces: [
      {
        id: "ubuntu",
        name: "Ubuntu",
        root: null,
        env: { kind: "wsl", distro: "Ubuntu" },
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: "debian",
        name: "Debian",
        root: null,
        env: { kind: "wsl", distro: "Debian" },
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeId: "debian",
  });
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  useWorkbench.setState({
    tabs: [
      { id: 901, kind: "terminal", spaceId: "ubuntu", title: "shell" },
      { id: 902, kind: "terminal", spaceId: "debian", title: "shell" },
    ],
  });
});

it("authorizes a background terminal's environment and deduplicates within that environment", () => {
  reportCwd(901, "/same/path");
  reportCwd(902, "/same/path");
  reportCwd(901, "/same/path");
  expect(native.workspaceAuthorize).toHaveBeenCalledTimes(2);
  expect(native.workspaceAuthorize).toHaveBeenNthCalledWith(1, "/same/path", {
    kind: "wsl",
    distro: "Ubuntu",
  });
  expect(native.workspaceAuthorize).toHaveBeenNthCalledWith(2, "/same/path", {
    kind: "wsl",
    distro: "Debian",
  });
});

it("retries failed authorization and ignores terminals already closed", async () => {
  vi.mocked(native.workspaceAuthorize).mockRejectedValueOnce(
    new Error("offline"),
  );
  reportCwd(901, "/retry/path");
  await Promise.resolve();
  reportCwd(901, "/retry/path");
  reportCwd(999, "/closed/path");
  expect(native.workspaceAuthorize).toHaveBeenCalledTimes(2);
});
