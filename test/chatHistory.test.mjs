import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatHistorySource = readFileSync(
  new URL("../src/chatHistory.ts", import.meta.url),
  "utf8",
);
const extensionSource = readFileSync(
  new URL("../src/extension.ts", import.meta.url),
  "utf8",
);
const webviewScript = readFileSync(
  new URL("../media/main.js", import.meta.url),
  "utf8",
);

test("chat history is stored in VS Code workspace state with bounded retention", () => {
  assert.match(chatHistorySource, /CHAT_HISTORY_STATE = "iaedu\.chatHistory\.v1"/);
  assert.match(chatHistorySource, /MAX_CHAT_THREADS = 30/);
  assert.match(chatHistorySource, /MAX_MESSAGES_PER_THREAD = 80/);
  assert.match(chatHistorySource, /workspaceState\.update\(CHAT_HISTORY_STATE/);
});

test("extension persists user and assistant messages by IAEDU thread", () => {
  assert.match(extensionSource, /ensureChatHistoryThread/);
  assert.match(extensionSource, /appendChatHistoryMessage/);
  assert.match(extensionSource, /stripLocalActionBlocks\(responseText\)/);
  assert.match(extensionSource, /getChatHistorySummaries/);
  assert.match(extensionSource, /getChatHistoryThread/);
});

test("extension can start, save, and switch saved conversations", () => {
  assert.match(extensionSource, /id="conversationSelect"/);
  assert.match(extensionSource, /id="saveConversation"/);
  assert.match(extensionSource, /type: "selectConversation"/);
  assert.match(extensionSource, /type: "saveConversation"/);
  assert.match(extensionSource, /setThreadId\(this\.context, selectedThreadId/);
});

test("webview renders saved conversation controls and reloads messages", () => {
  assert.match(webviewScript, /conversationSelect/);
  assert.match(webviewScript, /type: "selectConversation"/);
  assert.match(webviewScript, /type: "saveConversation"/);
  assert.match(webviewScript, /function loadConversation\(message\)/);
  assert.match(webviewScript, /function renderConversationSelect\(conversations, threadId\)/);
});

test("webview sends with Enter and queues prompts while busy", () => {
  assert.match(webviewScript, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(webviewScript, /event\.preventDefault\(\)/);
  assert.match(webviewScript, /sendButton\.textContent = value \? "queue" : "send"/);
  assert.doesNotMatch(webviewScript, /!text \|\| busy/);
  assert.match(extensionSource, /promptQueue/);
  assert.match(extensionSource, /queuePrompt/);
  assert.match(extensionSource, /runNextQueuedPrompt/);
  assert.match(extensionSource, /Queued message/);
});
