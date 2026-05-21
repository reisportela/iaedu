import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { IaeduMode } from "./editorContext";

const API_KEY_SECRET = "iaedu.apiKey";
const THREAD_ID_STATE = "iaedu.threadId";

export interface IaeduSettings {
  endpoint: string;
  channelId: string;
  apiKey: string;
  threadId: string;
  userInfo: string;
  maxContextChars: number;
  defaultIncludeActiveFile: boolean;
  defaultMode: IaeduMode;
}

export interface ConnectionSettingsInput {
  endpoint: string;
  channelId: string;
  apiKey?: string;
}

export function isConfigured(settings: IaeduSettings): boolean {
  return Boolean(settings.endpoint && settings.channelId && settings.apiKey);
}

export async function getSettings(
  context: vscode.ExtensionContext,
): Promise<IaeduSettings> {
  const config = vscode.workspace.getConfiguration("iaedu");
  const endpoint = config.get<string>("endpoint", "").trim();
  const channelId = config.get<string>("channelId", "").trim();
  const apiKey = (await context.secrets.get(API_KEY_SECRET)) || "";
  const userInfo = normalizeJsonString(
    config.get<string>("userInfo", "{\"source\":\"vscode-extension\"}"),
    "{\"source\":\"vscode-extension\"}",
  );
  const maxContextChars = config.get<number>("maxContextChars", 20000);
  const defaultIncludeActiveFile = config.get<boolean>(
    "defaultIncludeActiveFile",
    false,
  );
  const defaultMode = normalizeMode(config.get<string>("defaultMode", "ask"));

  return {
    endpoint,
    channelId,
    apiKey,
    threadId: getOrCreateThreadId(context),
    userInfo,
    maxContextChars,
    defaultIncludeActiveFile,
    defaultMode,
  };
}

export async function ensureSettings(
  context: vscode.ExtensionContext,
): Promise<IaeduSettings | undefined> {
  const existing = await getSettings(context);
  if (isConfigured(existing)) {
    return existing;
  }

  const action = await vscode.window.showInformationMessage(
    "Set the endpoint, channel_id and API key to use IAEDU.",
    { modal: true },
    "Configure",
  );
  if (action !== "Configure") {
    return undefined;
  }

  return configureConnection(context);
}

export async function configureConnection(
  context: vscode.ExtensionContext,
): Promise<IaeduSettings | undefined> {
  const config = vscode.workspace.getConfiguration("iaedu");
  let settings = await getSettings(context);

  const endpoint = await vscode.window.showInputBox({
    title: "IAEDU endpoint",
    prompt: "IAEDU agent-chat endpoint",
    value: settings.endpoint,
    ignoreFocusOut: true,
    placeHolder: "https://api.iaedu.pt/agent-chat/...",
  });
  if (!endpoint) {
    return undefined;
  }
  await config.update(
    "endpoint",
    endpoint.trim(),
    vscode.ConfigurationTarget.Workspace,
  );

  settings = await getSettings(context);
  const channelId = await vscode.window.showInputBox({
    title: "IAEDU channel_id",
    prompt: "channel_id value from the agent page",
    value: settings.channelId,
    ignoreFocusOut: true,
  });
  if (!channelId) {
    return undefined;
  }
  await config.update(
    "channelId",
    channelId.trim(),
    vscode.ConfigurationTarget.Workspace,
  );

  const apiKey = await vscode.window.showInputBox({
    title: "IAEDU API key",
    prompt: "The key is stored in VS Code SecretStorage",
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey && !settings.apiKey) {
    return undefined;
  }
  if (apiKey) {
    await context.secrets.store(API_KEY_SECRET, apiKey.trim());
  }

  const next = await getSettings(context);
  vscode.window.showInformationMessage("IAEDU sign-in/configuration complete.");
  return next;
}

export async function saveConnectionSettings(
  context: vscode.ExtensionContext,
  input: ConnectionSettingsInput,
): Promise<IaeduSettings | undefined> {
  const endpoint = input.endpoint.trim();
  const channelId = input.channelId.trim();
  const apiKey = input.apiKey?.trim();

  if (!endpoint || !channelId) {
    vscode.window.showWarningMessage(
      "Enter the endpoint and channel_id to use IAEDU.",
    );
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("iaedu");
  await config.update("endpoint", endpoint, vscode.ConfigurationTarget.Workspace);
  await config.update(
    "channelId",
    channelId,
    vscode.ConfigurationTarget.Workspace,
  );

  if (apiKey) {
    await context.secrets.store(API_KEY_SECRET, apiKey);
  }

  const next = await getSettings(context);
  if (!next.apiKey) {
    vscode.window.showWarningMessage("Enter the API key to use IAEDU.");
    return undefined;
  }

  vscode.window.showInformationMessage("IAEDU settings saved.");
  return next;
}

export async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: "IAEDU API key",
    prompt: "The key is stored in VS Code SecretStorage",
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) {
    return;
  }
  await context.secrets.store(API_KEY_SECRET, apiKey.trim());
  vscode.window.showInformationMessage("IAEDU API key saved.");
}

export async function logout(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("iaedu");
  await context.secrets.delete(API_KEY_SECRET);
  await config.update("endpoint", "", vscode.ConfigurationTarget.Workspace);
  await config.update("channelId", "", vscode.ConfigurationTarget.Workspace);
  startNewThread(context);
  vscode.window.showInformationMessage("IAEDU signed out.");
}

export async function setEndpoint(): Promise<void> {
  const config = vscode.workspace.getConfiguration("iaedu");
  const current = config.get<string>("endpoint", "");
  const endpoint = await vscode.window.showInputBox({
    title: "IAEDU endpoint",
    prompt: "IAEDU agent-chat endpoint",
    value: current,
    ignoreFocusOut: true,
  });
  if (!endpoint) {
    return;
  }
  await config.update("endpoint", endpoint.trim(), vscode.ConfigurationTarget.Workspace);
}

export async function setChannelId(): Promise<void> {
  const config = vscode.workspace.getConfiguration("iaedu");
  const current = config.get<string>("channelId", "");
  const channelId = await vscode.window.showInputBox({
    title: "IAEDU channel_id",
    prompt: "channel_id value from the agent page",
    value: current,
    ignoreFocusOut: true,
  });
  if (!channelId) {
    return;
  }
  await config.update("channelId", channelId.trim(), vscode.ConfigurationTarget.Workspace);
}

export async function importDotEnv(
  context: vscode.ExtensionContext,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a folder before importing .env.");
    return;
  }

  const envPath = path.join(workspaceFolder.uri.fsPath, ".env");
  if (!fs.existsSync(envPath)) {
    vscode.window.showWarningMessage(`Could not find .env at ${envPath}.`);
    return;
  }

  const values = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  const config = vscode.workspace.getConfiguration("iaedu");

  if (values.IAEDU_ENDPOINT) {
    await config.update(
      "endpoint",
      values.IAEDU_ENDPOINT,
      vscode.ConfigurationTarget.Workspace,
    );
  }
  if (values.IAEDU_CHANNEL_ID) {
    await config.update(
      "channelId",
      values.IAEDU_CHANNEL_ID,
      vscode.ConfigurationTarget.Workspace,
    );
  }
  if (values.IAEDU_API_KEY) {
    await context.secrets.store(API_KEY_SECRET, values.IAEDU_API_KEY);
  }
  if (values.IAEDU_THREAD_ID) {
    await context.workspaceState.update(THREAD_ID_STATE, values.IAEDU_THREAD_ID);
  }

  vscode.window.showInformationMessage("IAEDU settings imported from .env.");
}

export function startNewThread(context: vscode.ExtensionContext): string {
  const threadId = makeThreadId();
  context.workspaceState.update(THREAD_ID_STATE, threadId);
  return threadId;
}

export function getOrCreateThreadId(context: vscode.ExtensionContext): string {
  const existing = context.workspaceState.get<string>(THREAD_ID_STATE);
  if (existing) {
    return existing;
  }

  return startNewThread(context);
}

function makeThreadId(): string {
  return `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeJsonString(value: string, fallback: string): string {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return fallback;
  }
}

function normalizeMode(value: string): IaeduMode {
  if (value === "plan" || value === "agent") {
    return value;
  }
  return "ask";
}

function parseDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}
