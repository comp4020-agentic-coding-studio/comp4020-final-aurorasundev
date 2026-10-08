// A minimal EventSource for the spec: reads /api/events over fetch and
// collects named events, so tests can wait for one to arrive.
export type ServerEvent = { event: string; data: Record<string, unknown>; at: number };

export type Stream = {
  events: ServerEvent[];
  next: (event: string, match?: (data: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<ServerEvent>;
  close: () => void;
};

export async function openStream(url: URL): Promise<Stream> {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`event stream answered ${res.status}`);
  const events: ServerEvent[] = [];
  const waiters = new Set<() => void>();

  void (async () => {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          events.push({ event, data: JSON.parse(data) as Record<string, unknown>, at: performance.now() });
          for (const wake of waiters) wake();
        }
      }
    } catch {
      // aborted on close
    }
  })();

  return {
    events,
    next(event, match = () => true, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const check = (): boolean => {
          const hit = events.find((e) => e.event === event && match(e.data));
          if (hit) resolve(hit);
          return !!hit;
        };
        if (check()) return;
        const timer = setTimeout(() => {
          waiters.delete(wake);
          reject(new Error(`no ${event} event within ${timeoutMs}ms`));
        }, timeoutMs);
        const wake = (): void => {
          if (check()) {
            clearTimeout(timer);
            waiters.delete(wake);
          }
        };
        waiters.add(wake);
      });
    },
    close: () => controller.abort(),
  };
}
