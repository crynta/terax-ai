const pending = new Map<object, () => void>();
let channel: MessageChannel | null = null;
let posted = false;

function closeChannel(): void {
  if (channel) {
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
  }
  channel = null;
  posted = false;
}

function post(): void {
  if (!channel || posted) return;
  posted = true;
  channel.port2.postMessage(null);
}

export function schedulePtyParse(callback: () => void): () => void {
  if (typeof MessageChannel === "undefined") {
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
  }
  const token = {};
  if (!channel) {
    const owned = new MessageChannel();
    channel = owned;
    owned.port1.onmessage = () => {
      if (channel !== owned) return;
      posted = false;
      const task = pending.entries().next().value;
      if (task) pending.delete(task[0]);
      try {
        task?.[1]();
      } finally {
        if (channel === owned) {
          if (pending.size === 0) closeChannel();
          else post();
        }
      }
    };
  }
  pending.set(token, callback);
  post();
  return () => {
    pending.delete(token);
    if (pending.size === 0) closeChannel();
  };
}
