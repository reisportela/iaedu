import { parseIaeduEventLine } from "./streamParser";

export interface IaeduChatRequest {
  endpoint: string;
  apiKey: string;
  channelId: string;
  threadId: string;
  message: string;
  userInfo: string;
  userContext?: string;
  signal?: AbortSignal;
}

export async function sendIaeduMessage(
  request: IaeduChatRequest,
  onDelta: (text: string) => void,
): Promise<string> {
  const formData = new FormData();
  formData.append("channel_id", request.channelId);
  formData.append("thread_id", request.threadId);
  formData.append("user_info", request.userInfo);
  formData.append("message", request.message);

  if (request.userContext) {
    formData.append("user_context", request.userContext);
  }

  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: {
      "x-api-key": request.apiKey,
    },
    body: formData,
    signal: request.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`IAEDU API error ${response.status}: ${body}`);
  }

  if (!response.body) {
    const text = await response.text();
    return collectFromText(text, onDelta);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  let sawToken = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const parsed = parseIaeduEventLine(line);
      if (parsed.kind === "token") {
        sawToken = true;
        result += parsed.text;
        onDelta(parsed.text);
      } else if (parsed.kind === "message" && !sawToken) {
        result += parsed.text;
        onDelta(parsed.text);
      } else if (parsed.kind === "error") {
        throw new Error(parsed.text);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    const parsed = parseIaeduEventLine(buffer);
    if (parsed.kind === "token") {
      result += parsed.text;
      onDelta(parsed.text);
    } else if (parsed.kind === "message" && !sawToken) {
      result += parsed.text;
      onDelta(parsed.text);
    } else if (parsed.kind === "error") {
      throw new Error(parsed.text);
    }
  }

  return result;
}

function collectFromText(text: string, onDelta: (text: string) => void): string {
  let result = "";
  let sawToken = false;

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseIaeduEventLine(line);
    if (parsed.kind === "token") {
      sawToken = true;
      result += parsed.text;
      onDelta(parsed.text);
    } else if (parsed.kind === "message" && !sawToken) {
      result += parsed.text;
      onDelta(parsed.text);
    } else if (parsed.kind === "error") {
      throw new Error(parsed.text);
    }
  }

  if (!result && text.trim()) {
    result = text;
    onDelta(text);
  }

  return result;
}

