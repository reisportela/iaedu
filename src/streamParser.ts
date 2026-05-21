export type ParsedIaeduEvent =
  | { kind: "none" }
  | { kind: "token"; text: string }
  | { kind: "message"; text: string }
  | { kind: "error"; text: string };

function extractContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (
    content &&
    typeof content === "object" &&
    "content" in content &&
    typeof (content as { content?: unknown }).content === "string"
  ) {
    return (content as { content: string }).content;
  }

  return undefined;
}

export function parseIaeduEventLine(line: string): ParsedIaeduEvent {
  const trimmed = line.trim();
  if (!trimmed) {
    return { kind: "none" };
  }

  let payload = trimmed;
  if (payload.startsWith("data:")) {
    payload = payload.slice("data:".length).trim();
  }

  if (payload === "[DONE]") {
    return { kind: "none" };
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return { kind: "none" };
  }

  if (!event || typeof event !== "object") {
    return { kind: "none" };
  }

  const typedEvent = event as { type?: unknown; content?: unknown };
  const type = typedEvent.type;

  if (type === "token" && typeof typedEvent.content === "string") {
    return { kind: "token", text: typedEvent.content };
  }

  if (type === "message") {
    const text = extractContent(typedEvent.content);
    return text ? { kind: "message", text } : { kind: "none" };
  }

  if (type === "error") {
    const text = extractContent(typedEvent.content) || JSON.stringify(event);
    return { kind: "error", text };
  }

  return { kind: "none" };
}

