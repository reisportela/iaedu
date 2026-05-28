import * as vscode from "vscode";
import type { IaeduMode } from "./editorContext";

const CHAT_HISTORY_STATE = "iaedu.chatHistory.v1";
const MAX_CHAT_THREADS = 30;
const MAX_MESSAGES_PER_THREAD = 80;
const MAX_MESSAGE_CHARS = 50000;
const MAX_TITLE_CHARS = 72;
const NEW_CHAT_TITLE = "New chat";

export type ChatHistoryRole = "user" | "assistant" | "error";
export type ChatHistoryContextMode = "selection" | "activeFile";

export interface ChatHistoryMessage {
  id: string;
  role: ChatHistoryRole;
  text: string;
  createdAt: number;
  mode?: IaeduMode;
  contextMode?: ChatHistoryContextMode;
  codexSkills?: boolean;
}

export interface ChatHistoryThread {
  threadId: string;
  profileId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatHistoryMessage[];
}

export interface ChatHistorySummary {
  threadId: string;
  profileId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface ChatHistoryMessageInput {
  role: ChatHistoryRole;
  text: string;
  mode?: IaeduMode;
  contextMode?: ChatHistoryContextMode;
  codexSkills?: boolean;
}

export async function ensureChatHistoryThread(
  context: vscode.ExtensionContext,
  profileId: string,
  threadId: string,
): Promise<ChatHistoryThread> {
  const threads = readThreads(context);
  const existing = findThread(threads, profileId, threadId);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const thread: ChatHistoryThread = {
    threadId,
    profileId,
    title: NEW_CHAT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await writeThreads(context, [thread, ...threads]);
  return thread;
}

export async function appendChatHistoryMessage(
  context: vscode.ExtensionContext,
  profileId: string,
  threadId: string,
  input: ChatHistoryMessageInput,
): Promise<ChatHistoryThread> {
  const threads = readThreads(context);
  const now = Date.now();
  const message: ChatHistoryMessage = {
    id: makeMessageId(),
    role: input.role,
    text: truncateText(input.text),
    createdAt: now,
    mode: input.mode,
    contextMode: input.contextMode,
    codexSkills: input.codexSkills,
  };
  const thread = findThread(threads, profileId, threadId) || {
    threadId,
    profileId,
    title: NEW_CHAT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  thread.messages = [...thread.messages, message].slice(-MAX_MESSAGES_PER_THREAD);
  thread.updatedAt = now;
  if (input.role === "user" && shouldRetitle(thread.title)) {
    thread.title = deriveThreadTitle(input.text);
  }

  await writeThreads(context, upsertThread(threads, thread));
  return thread;
}

export async function touchChatHistoryThread(
  context: vscode.ExtensionContext,
  profileId: string,
  threadId: string,
): Promise<ChatHistoryThread> {
  const threads = readThreads(context);
  const existing = findThread(threads, profileId, threadId);
  if (!existing) {
    return ensureChatHistoryThread(context, profileId, threadId);
  }

  existing.updatedAt = Date.now();
  await writeThreads(context, upsertThread(threads, existing));
  return existing;
}

export function getChatHistoryThread(
  context: vscode.ExtensionContext,
  profileId: string,
  threadId: string,
): ChatHistoryThread | undefined {
  return findThread(readThreads(context), profileId, threadId);
}

export function getChatHistorySummaries(
  context: vscode.ExtensionContext,
  profileId: string,
): ChatHistorySummary[] {
  return readThreads(context)
    .filter((thread) => thread.profileId === profileId)
    .sort(sortNewestFirst)
    .map((thread) => ({
      threadId: thread.threadId,
      profileId: thread.profileId,
      title: thread.title || NEW_CHAT_TITLE,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
    }));
}

export function stripLocalActionBlocks(text: string): string {
  const source = text || "";
  const startPattern = /```(?:iaedu-action|iaedu-actions)\b[^\n]*\n?/gi;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(source)) !== null) {
    result += source.slice(cursor, match.index);
    const endIndex = source.indexOf("```", startPattern.lastIndex);
    if (endIndex < 0) {
      cursor = source.length;
      break;
    }
    cursor = endIndex + 3;
    startPattern.lastIndex = cursor;
  }
  result += source.slice(cursor);
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function readThreads(context: vscode.ExtensionContext): ChatHistoryThread[] {
  return normalizeThreads(context.workspaceState.get<unknown>(CHAT_HISTORY_STATE));
}

async function writeThreads(
  context: vscode.ExtensionContext,
  threads: ChatHistoryThread[],
): Promise<void> {
  const deduped = normalizeThreads(threads).sort(sortNewestFirst).slice(0, MAX_CHAT_THREADS);
  await context.workspaceState.update(CHAT_HISTORY_STATE, deduped);
}

function normalizeThreads(value: unknown): ChatHistoryThread[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const threads: ChatHistoryThread[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<ChatHistoryThread>;
    const threadId = normalizeText(candidate.threadId);
    const profileId = normalizeText(candidate.profileId);
    if (!threadId || !profileId) {
      continue;
    }

    const key = threadKey(profileId, threadId);
    if (seen.has(key)) {
      continue;
    }

    const messages = normalizeMessages(candidate.messages).slice(-MAX_MESSAGES_PER_THREAD);
    const createdAt = normalizeTimestamp(candidate.createdAt);
    const updatedAt = normalizeTimestamp(candidate.updatedAt) || createdAt || Date.now();
    threads.push({
      threadId,
      profileId,
      title: normalizeTitle(candidate.title) || deriveTitleFromMessages(messages),
      createdAt: createdAt || updatedAt,
      updatedAt,
      messages,
    });
    seen.add(key);
  }

  return threads;
}

function normalizeMessages(value: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const messages: ChatHistoryMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<ChatHistoryMessage>;
    const role = normalizeRole(candidate.role);
    const text = truncateText(normalizeText(candidate.text));
    if (!role || !text) {
      continue;
    }

    messages.push({
      id: normalizeText(candidate.id) || makeMessageId(),
      role,
      text,
      createdAt: normalizeTimestamp(candidate.createdAt) || Date.now(),
      mode: normalizeMode(candidate.mode),
      contextMode: normalizeContextMode(candidate.contextMode),
    });
  }

  return messages;
}

function findThread(
  threads: ChatHistoryThread[],
  profileId: string,
  threadId: string,
): ChatHistoryThread | undefined {
  return threads.find(
    (thread) => thread.profileId === profileId && thread.threadId === threadId,
  );
}

function upsertThread(
  threads: ChatHistoryThread[],
  nextThread: ChatHistoryThread,
): ChatHistoryThread[] {
  const found = threads.some(
    (thread) =>
      thread.profileId === nextThread.profileId &&
      thread.threadId === nextThread.threadId,
  );
  if (!found) {
    return [nextThread, ...threads];
  }

  return threads.map((thread) =>
    thread.profileId === nextThread.profileId &&
    thread.threadId === nextThread.threadId
      ? nextThread
      : thread,
  );
}

function shouldRetitle(title: string): boolean {
  return !title || title === NEW_CHAT_TITLE;
}

function deriveThreadTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return NEW_CHAT_TITLE;
  }

  return collapsed.length > MAX_TITLE_CHARS
    ? `${collapsed.slice(0, MAX_TITLE_CHARS - 1)}...`
    : collapsed;
}

function deriveTitleFromMessages(messages: ChatHistoryMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  return firstUserMessage ? deriveThreadTitle(firstUserMessage.text) : NEW_CHAT_TITLE;
}

function normalizeTitle(value: unknown): string {
  const text = normalizeText(value);
  return text ? deriveThreadTitle(text) : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(value: unknown): ChatHistoryRole | undefined {
  if (value === "user" || value === "assistant" || value === "error") {
    return value;
  }
  return undefined;
}

function normalizeMode(value: unknown): IaeduMode | undefined {
  if (value === "ask" || value === "plan" || value === "agent") {
    return value;
  }
  return undefined;
}

function normalizeContextMode(
  value: unknown,
): ChatHistoryContextMode | undefined {
  if (value === "selection" || value === "activeFile") {
    return value;
  }
  return undefined;
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function truncateText(text: string): string {
  if (text.length <= MAX_MESSAGE_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n[message truncated]`;
}

function sortNewestFirst(
  left: ChatHistoryThread,
  right: ChatHistoryThread,
): number {
  return right.updatedAt - left.updatedAt;
}

function threadKey(profileId: string, threadId: string): string {
  return `${profileId}\u0000${threadId}`;
}

function makeMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
