import type { ReactNode } from "react";

type WindowLike = {
  show: () => Promise<void>;
};

type RootLike = {
  render: (children: ReactNode) => void;
};

type Timer = (callback: () => void, delay: number) => unknown;

type StartMainWindowOptions = {
  app: ReactNode;
  closeAllPtys: () => Promise<unknown>;
  createRoot: (container: HTMLElement) => RootLike;
  currentWindow: WindowLike;
  initLaunchDir: () => Promise<void>;
  logError?: (...data: unknown[]) => void;
  root: HTMLElement | null;
  setTimer?: Timer;
};

const STARTUP_WAIT_MS = 500;

function scheduleWindowShow(
  currentWindow: WindowLike,
  setTimer: Timer,
  logError: (...data: unknown[]) => void,
) {
  const showWindow = () => {
    currentWindow
      .show()
      .catch((e) => logError("window.show failed:", e));
  };

  setTimer(showWindow, 50);
  setTimer(showWindow, 500);
}

async function waitForStartupTask(
  task: Promise<unknown>,
  logError: (...data: unknown[]) => void,
) {
  let timedOut = false;
  await Promise.race([
    task.catch((e) => logError("startup task failed:", e)),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, STARTUP_WAIT_MS);
    }),
  ]);

  if (timedOut) {
    logError(`startup task exceeded ${STARTUP_WAIT_MS}ms; continuing render`);
  }
}

export async function startMainWindow({
  app,
  closeAllPtys,
  createRoot,
  currentWindow,
  initLaunchDir,
  logError = console.error,
  root,
  setTimer = setTimeout,
}: StartMainWindowOptions) {
  scheduleWindowShow(currentWindow, setTimer, logError);

  void closeAllPtys().catch((e) => logError("pty cleanup failed:", e));
  await waitForStartupTask(initLaunchDir(), logError);

  if (!root) {
    throw new Error("Missing #root element");
  }

  createRoot(root).render(app);
}
