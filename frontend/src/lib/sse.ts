export interface SseEvent<T = unknown> {
  event: string;
  data: T;
}

/** Parses complete SSE frames and keeps an incomplete tail for the next chunk. */
export function parseSseChunk(chunk: string, remainder = ""): { events: SseEvent[]; remainder: string } {
  const input = remainder + chunk;
  const frames = input.split(/\r?\n\r?\n/);
  const tail = frames.pop() ?? "";
  const events = frames.flatMap((frame) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return [];
    const payload = dataLines.join("\n");
    try {
      return [{ event, data: JSON.parse(payload) }];
    } catch {
      return [{ event, data: payload }];
    }
  });
  return { events, remainder: tail };
}
