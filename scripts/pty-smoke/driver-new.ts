import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  openPty,
  ptyTransportDiagnostics,
} from "@/modules/terminal/lib/pty-bridge";
import { setLeafPresentation } from "@/modules/terminal/lib/ptyPresentation";
import { encodeRequest, tokenBytes } from "@/modules/terminal/lib/ptyWire";
import type { Driver } from "./scenarios";

const realFetch = window.fetch.bind(window);
const wire = { polls: 0, acks: 0, responses: 0, ipcInvokes: 0 };
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : String(input);
  if (url.includes("terax-pty")) {
    if (url.endsWith("/poll")) wire.polls++;
    else wire.acks++;
  } else if (url.startsWith("ipc://") || url.includes("ipc.localhost")) {
    wire.ipcInvokes++;
  }
  return realFetch(input, init);
}) as typeof window.fetch;

declare const __SMOKE_BASE_URL__: string;

type HubCounters = Record<string, number>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hubCounters = async (): Promise<HubCounters> =>
  ((await invoke<{ hub: HubCounters }>("pty_diagnostics")).hub);
// Anything that reaches the hub moves one of these; refusals must move none.
const hubWork = (c: HubCounters) =>
  [c.wakeups, c.polls, c.ackRequests, c.rejectedRequests].join(",");

const post = (path: string, body: Uint8Array<ArrayBuffer>) =>
  realFetch(convertFileSrc(path, "terax-pty"), {
    method: "POST",
    body,
    cache: "no-store",
    credentials: "omit",
  }).then((response) => response.status);

/**
 * A preview-style frame holding a valid token: another origin entirely (the
 * report server), loaded the way the preview loads any web page.
 */
function foreignFrame(body: Uint8Array, attempts: number) {
  return new Promise<{ readable: boolean; status?: number }[]>((resolve, reject) => {
    const frame = document.createElement("iframe");
    let loaded = false;
    let started = false;
    frame.addEventListener("load", () => {
      loaded = true;
    });
    const timer = setTimeout(
      () => reject(new Error(`foreign frame timed out (loaded=${loaded}, started=${started})`)),
      20_000,
    );
    const listen = (event: MessageEvent) => {
      if (event.origin !== new URL(__SMOKE_BASE_URL__).origin) return;
      if (typeof event.data !== "object") return;
      if (event.data.hello) {
        started = true;
        return;
      }
      window.removeEventListener("message", listen);
      clearTimeout(timer);
      frame.remove();
      resolve(event.data.frame);
    };
    window.addEventListener("message", listen);
    const request = encodeURIComponent(
      JSON.stringify({
        url: convertFileSrc("ack", "terax-pty"),
        body: [...body],
        attempts,
      }),
    );
    frame.src = `${__SMOKE_BASE_URL__}/frame.html#${request}`;
    document.body.append(frame);
  });
}

/**
 * The scheme is reachable from any frame, so refusals must happen before the
 * hub is woken: wrong token, malformed or oversized body, wrong method and a
 * foreign origin holding a valid token. Reopens the stream, so it must be the
 * last thing a page does before it is discarded.
 */
async function probeGate() {
  const hex = await invoke<string>("pty_stream_open");
  const token = tokenBytes(hex);
  const valid = encodeRequest(token, []);
  const wrong = new Uint8Array(valid);
  wrong[0] ^= 0xff;
  await sleep(500);

  const control = await post("ack", valid);
  await sleep(300);
  const before = await hubCounters();

  const wrongToken = await Promise.all(Array.from({ length: 20 }, () => post("ack", wrong)));
  const oversized = await post("ack", new Uint8Array(8192));
  const malformed = await post("poll", valid.slice(0, 5));
  const method = await realFetch(convertFileSrc("poll", "terax-pty")).then((r) => r.status);
  await sleep(300);
  const afterPage = await hubCounters();

  const frames = await foreignFrame(valid, 10);
  await sleep(300);
  const afterFrame = await hubCounters();

  return {
    originIsAppOrigin: location.origin,
    positiveControl: control,
    wrongToken: [...new Set(wrongToken)],
    oversized,
    malformed,
    wrongMethod: method,
    hubUntouchedByPageRefusals: hubWork(before) === hubWork(afterPage),
    foreignOrigin: {
      attempts: frames.length,
      anyReadable: frames.some((f) => f.readable),
      hubUntouched: hubWork(afterPage) === hubWork(afterFrame),
    },
    counters: { before, afterPage, afterFrame },
  };
}

export const driver: Driver = {
  name: "multiplexed pull stream (terax-pty)",
  openPty,
  setPresentation: setLeafPresentation,
  // A poll and its response are one round trip; ack-only requests are extra.
  streamOps: () => wire.polls + wire.acks,
  breakdown: () => ({ ...wire }),
  native: () => invoke("pty_diagnostics"),
  jsHub: () => ptyTransportDiagnostics().hub,
  probeGate,
  realFetch,
};
