import type {
  PtyOutputReceiver,
  PtyTransportStatus,
} from "@/modules/terminal/lib/PtyOutputReceiver";
import {
  decodeFrames,
  encodeRequest,
  MAX_ACKS_PER_REQUEST,
  PTY_WINDOW_BYTES,
  type PtyAck,
  type PtyFrame,
} from "@/modules/terminal/lib/ptyWire";

/** Unparsed-but-acknowledgeable bytes that justify an ack-only request. */
export const ACK_ONLY_BYTES = PTY_WINDOW_BYTES / 2;
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 1_000;
const STALL_AFTER_FAILURES = 5;

export type PtyStreamResponse = { status: number; body: Uint8Array };

/** The network edge of the stream; faked in tests, `fetch` in the app. */
export interface PtyStreamTransport {
  /** Opens (or reopens) the stream and returns its secret token. */
  open(): Promise<Uint8Array>;
  /** Long poll: resolves when native has output due, or after a keepalive. */
  poll(
    body: Uint8Array<ArrayBuffer>,
    signal: AbortSignal,
  ): Promise<PtyStreamResponse>;
  ack(body: Uint8Array<ArrayBuffer>): Promise<PtyStreamResponse>;
}

type Entry = {
  readonly id: number;
  readonly receiver: PtyOutputReceiver;
  readonly onExit: (code: number) => void;
  /** Bytes delivered to the receiver: the offset the next data frame must carry. */
  received: number;
  /** Cumulative bytes the receiver finished parsing (at chunk boundaries). */
  target: number;
  /** Highest `target` included in a request that is outstanding or applied. */
  sent: number;
  /** Highest `target` known to be applied natively. */
  confirmed: number;
  /** An acknowledgement entry (the attach announcement) was sent. */
  attachSent: boolean;
  /** Native accepted the attach announcement. */
  attached: boolean;
  /** Native is waiting on this PTY: acknowledge as soon as bytes are parsed. */
  urgent: boolean;
  /** Exited or failed: no more acknowledgements. */
  dead: boolean;
};

type Included = { entry: Entry; bytes: number };

export type PtyStreamHandle = {
  /** The receiver parsed up to this cumulative offset. */
  progress(processedBytes: number): void;
};

/**
 * Owns the single long-poll loop that carries every terminal's output.
 *
 * Native holds one outstanding `poll` and answers when some terminal's output
 * is due; this hub immediately issues the next poll (before parsing, so
 * delivery latency never includes parse time) and demultiplexes the frames to
 * each terminal's `PtyOutputReceiver`. Acknowledgements are cumulative parsed
 * offsets; they ride on the next poll, with an ack-only request only when a
 * terminal's unsent progress passes half the window while a poll is held, or
 * when native says it is waiting on one.
 */
export class PtyOutputHub {
  private readonly entries = new Map<number, Entry>();
  private token: Uint8Array | null = null;
  private opening: Promise<void> | null = null;
  private poll: { controller: AbortController } | null = null;
  private ackInFlight = false;
  private ackQueued = false;
  private kickQueued = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private transportStatus: PtyTransportStatus = "ok";
  private disposed = false;
  private stats = {
    polls: 0,
    ackRequests: 0,
    responses: 0,
    keepalives: 0,
    frames: 0,
    dataBytes: 0,
    failures: 0,
    attachOnlyRequests: 0,
  };

  constructor(private readonly transport: PtyStreamTransport) {}

  /** Must resolve before a PTY is opened: the stream needs its token first. */
  ensureStream(): Promise<void> {
    if (this.token) return Promise.resolve();
    this.opening ??= this.transport.open().then(
      (token) => {
        if (!this.disposed) this.token = token;
      },
      (error) => {
        this.opening = null;
        throw error;
      },
    );
    return this.opening;
  }

  /**
   * Starts delivering a PTY's output. Native holds a terminal's output until
   * its receiver announces itself here, so nothing can arrive for an id the
   * frontend does not know yet.
   */
  register(
    id: number,
    receiver: PtyOutputReceiver,
    onExit: (code: number) => void,
  ): PtyStreamHandle {
    const entry: Entry = {
      id,
      receiver,
      onExit,
      received: 0,
      target: 0,
      sent: 0,
      confirmed: 0,
      attachSent: false,
      attached: false,
      urgent: false,
      dead: false,
    };
    this.entries.set(id, entry);
    receiver.setTransportStatus(this.transportStatus);
    // Terminals opened in the same tick announce themselves in one request.
    this.queueKick();
    return {
      progress: (processedBytes) => this.progress(entry, processedBytes),
    };
  }

  unregister(id: number): void {
    if (!this.entries.delete(id)) return;
    if (this.entries.size === 0) this.stop();
  }

  /** Visible "Retry": cancel the backoff and send again now. */
  retry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.kick();
  }

  diagnostics() {
    return {
      streamOpen: this.token !== null,
      entries: this.entries.size,
      polling: this.poll !== null,
      transport: this.transportStatus,
      consecutiveFailures: this.failures,
      ...this.stats,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.entries.clear();
    this.token = null;
    this.opening = null;
  }

  // -- request scheduling --------------------------------------------------

  private hasLiveEntries(): boolean {
    for (const entry of this.entries.values())
      if (!entry.dead && !entry.receiver.hasFailed) return true;
    return false;
  }

  private queueKick(): void {
    if (this.kickQueued) return;
    this.kickQueued = true;
    queueMicrotask(() => {
      this.kickQueued = false;
      this.kick();
    });
  }

  private kick(): void {
    if (this.disposed || !this.token || this.retryTimer !== null) return;
    if (!this.hasLiveEntries()) return;
    if (this.poll === null) this.issuePoll();
    else if (this.needsAckOnly()) this.queueAckOnly();
  }

  private progress(entry: Entry, processedBytes: number): void {
    if (entry.dead || this.entries.get(entry.id) !== entry) return;
    if (processedBytes <= entry.target) return;
    entry.target = processedBytes;
    this.kick();
  }

  /** Does any terminal need its progress sent without waiting for a poll? */
  private needsAckOnly(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.dead || entry.receiver.hasFailed) continue;
      if (!entry.attachSent) return true;
      const unsent = entry.target - entry.sent;
      if (unsent > 0 && (entry.urgent || unsent >= ACK_ONLY_BYTES)) return true;
    }
    return false;
  }

  /** Cumulative acknowledgements not yet sent, plus pending attach announcements. */
  private collect(): { acks: PtyAck[]; included: Included[] } {
    const acks: PtyAck[] = [];
    const included: Included[] = [];
    for (const entry of this.entries.values()) {
      if (acks.length >= MAX_ACKS_PER_REQUEST) break;
      if (entry.dead || entry.receiver.hasFailed) continue;
      if (entry.attachSent && entry.target <= entry.sent) continue;
      acks.push({ id: entry.id, bytes: entry.target });
      included.push({ entry, bytes: entry.target });
      entry.attachSent = true;
      entry.sent = Math.max(entry.sent, entry.target);
      if (entry.sent >= entry.received) entry.urgent = false;
    }
    return { acks, included };
  }

  private confirm(included: readonly Included[]): void {
    for (const { entry, bytes } of included) {
      entry.confirmed = Math.max(entry.confirmed, bytes);
      entry.attached = true;
    }
  }

  private revert(included: readonly Included[]): void {
    for (const { entry, bytes } of included) {
      if (entry.sent === bytes) entry.sent = entry.confirmed;
      if (!entry.attached) entry.attachSent = false;
    }
  }

  private issuePoll(): void {
    const token = this.token;
    if (
      this.disposed ||
      !token ||
      this.poll !== null ||
      this.retryTimer !== null ||
      !this.hasLiveEntries()
    )
      return;
    const { acks, included } = this.collect();
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = encodeRequest(token, acks);
    } catch (error) {
      this.revert(included);
      this.failAll(error);
      return;
    }
    const current = { controller: new AbortController() };
    this.poll = current;
    this.stats.polls++;
    this.transport.poll(body, current.controller.signal).then(
      (response) => this.pollSettled(current, included, response),
      (error) => this.pollRejected(current, included, error),
    );
    // More terminals than one request can carry: send the rest right away.
    if (this.needsAckOnly()) this.queueAckOnly();
  }

  private pollSettled(
    current: { controller: AbortController },
    included: readonly Included[],
    response: PtyStreamResponse,
  ): void {
    if (this.poll !== current) return;
    this.poll = null;
    if (response.status !== 200) {
      this.requestRefused(included, response.status);
      return;
    }
    this.confirm(included);
    this.noteSuccess();
    this.stats.responses++;
    // Poll again first: native can start coalescing the next batch while this
    // one is still being parsed.
    this.issuePoll();
    if (response.body.length === 0) {
      this.stats.keepalives++;
      return;
    }
    this.dispatch(response.body);
    if (this.needsAckOnly()) this.queueAckOnly();
  }

  private pollRejected(
    current: { controller: AbortController },
    included: readonly Included[],
    error: unknown,
  ): void {
    if (this.poll !== current) return; // aborted by stop()
    this.poll = null;
    this.requestFailed(included, error);
  }

  private queueAckOnly(): void {
    if (this.ackQueued) return;
    this.ackQueued = true;
    queueMicrotask(() => {
      this.ackQueued = false;
      this.sendAckOnly();
    });
  }

  private sendAckOnly(): void {
    const token = this.token;
    if (
      this.disposed ||
      !token ||
      this.ackInFlight ||
      this.retryTimer !== null ||
      !this.hasLiveEntries()
    )
      return;
    if (this.poll === null) {
      this.issuePoll();
      return;
    }
    const { acks, included } = this.collect();
    if (acks.length === 0) return;
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = encodeRequest(token, acks);
    } catch (error) {
      this.revert(included);
      this.failAll(error);
      return;
    }
    this.ackInFlight = true;
    this.stats.ackRequests++;
    if (acks.every((ack) => ack.bytes === 0)) this.stats.attachOnlyRequests++;
    this.transport.ack(body).then(
      (response) => {
        this.ackInFlight = false;
        if (response.status === 200) {
          this.confirm(included);
          this.noteSuccess();
          if (this.needsAckOnly()) this.queueAckOnly();
        } else this.requestRefused(included, response.status);
      },
      (error) => {
        this.ackInFlight = false;
        this.requestFailed(included, error);
      },
    );
  }

  // -- frames --------------------------------------------------------------

  private dispatch(body: Uint8Array): void {
    let frames: PtyFrame[];
    try {
      frames = decodeFrames(body);
    } catch (error) {
      this.failAll(error);
      return;
    }
    this.stats.frames += frames.length;
    for (const frame of frames) {
      // Frames can outlive a terminal that closed while they were in flight.
      const entry = this.entries.get(frame.id);
      if (!entry || entry.dead) continue;
      switch (frame.kind) {
        case "data":
          if (frame.offset !== entry.received) {
            this.failEntry(
              entry,
              new Error(
                `PTY output stream lost bytes (expected offset ${entry.received}, received ${frame.offset})`,
              ),
            );
            break;
          }
          entry.received += frame.bytes.length;
          this.stats.dataBytes += frame.bytes.length;
          entry.receiver.receive(frame.bytes);
          break;
        case "exit":
          entry.dead = true;
          try {
            entry.onExit(frame.code);
          } catch (error) {
            console.error("[terax] PTY exit handler failed:", error);
          }
          break;
        case "failed":
          this.failEntry(entry, new Error(frame.reason));
          break;
        case "sync":
          // Only worth rushing if some received bytes were not yet sent.
          if (entry.sent < entry.received) entry.urgent = true;
          break;
      }
    }
  }

  private failEntry(entry: Entry, error: unknown): void {
    entry.dead = true;
    entry.receiver.fail(error);
  }

  private failAll(error: unknown): void {
    this.stop();
    for (const entry of this.entries.values()) this.failEntry(entry, error);
  }

  // -- failure handling ----------------------------------------------------

  private noteSuccess(): void {
    if (this.failures === 0 && this.transportStatus === "ok") return;
    this.failures = 0;
    this.setTransport("ok");
  }

  private setTransport(status: PtyTransportStatus): void {
    if (this.transportStatus === status) return;
    this.transportStatus = status;
    for (const entry of this.entries.values())
      entry.receiver.setTransportStatus(status);
  }

  /** The webview answered with a refusal rather than failing to answer. */
  private requestRefused(included: readonly Included[], status: number): void {
    if (status === 403 || status === 410) {
      // The token no longer matches: the stream was reset underneath us.
      this.revert(included);
      this.token = null;
      this.opening = null;
      this.failAll(new Error("The PTY output stream was reset"));
      return;
    }
    this.requestFailed(
      included,
      new Error(`PTY stream request refused (${status})`),
    );
  }

  private requestFailed(included: readonly Included[], error: unknown): void {
    this.revert(included);
    if (this.disposed) return;
    this.failures += 1;
    this.stats.failures += 1;
    if (this.failures === 1)
      console.warn("[terax] PTY stream request failed:", error);
    this.setTransport(
      this.failures >= STALL_AFTER_FAILURES ? "stalled" : "retrying",
    );
    if (this.retryTimer !== null || this.entries.size === 0) return;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.kick();
      },
      Math.min(
        RETRY_MAX_MS,
        RETRY_BASE_MS * 2 ** Math.min(this.failures - 1, 5),
      ),
    );
  }

  /** No terminals left, or the stream is gone: release the held request. */
  private stop(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const poll = this.poll;
    this.poll = null;
    poll?.controller.abort();
    this.failures = 0;
    this.transportStatus = "ok";
  }
}
