import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { IaeduMode } from "./editorContext";

const LEGACY_API_KEY_SECRET = "iaedu.apiKey";
const API_KEY_SECRET_PREFIX = "iaedu.apiKey.profile.";
const LEGACY_THREAD_ID_STATE = "iaedu.threadId";
const THREAD_ID_STATE_PREFIX = "iaedu.threadId.profile.";
const MODEL_PROFILES_CONFIG = "modelProfiles";
const ACTIVE_MODEL_PROFILE_CONFIG = "activeModelProfileId";
const LEGACY_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default model";

export interface IaeduModelProfile {
  id: string;
  name: string;
  endpoint: string;
  channelId: string;
}

export interface IaeduModelProfileStatus extends IaeduModelProfile {
  hasApiKey: boolean;
}

export interface IaeduSettings {
  endpoint: string;
  channelId: string;
  apiKey: string;
  threadId: string;
  userInfo: string;
  maxContextChars: number;
  defaultIncludeActiveFile: boolean;
  defaultMode: IaeduMode;
  modelProfileId: string;
  modelName: string;
  modelProfiles: IaeduModelProfileStatus[];
}

export interface ConnectionSettingsInput {
  profileId?: string;
  profileName?: string;
  endpoint: string;
  apiKey?: string;
  channelId: string;
  requireApiKey?: boolean;
  requireComplete?: boolean;
}

export function isConfigured(settings: IaeduSettings): boolean {
  return Boolean(settings.endpoint && settings.channelId && settings.apiKey);
}

export async function getSettings(
  context: vscode.ExtensionContext,
): Promise<IaeduSettings> {
  const config = vscode.workspace.getConfiguration("iaedu");
  const profiles = await getStoredModelProfiles(context);
  const activeProfile = resolveActiveProfile(config, profiles);
  const profileId = activeProfile?.id || LEGACY_PROFILE_ID;
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
    endpoint: activeProfile?.endpoint || "",
    channelId: activeProfile?.channelId || "",
    apiKey: await getProfileApiKey(context, profileId),
    threadId: getOrCreateThreadId(context, profileId),
    userInfo,
    maxContextChars,
    defaultIncludeActiveFile,
    defaultMode,
    modelProfileId: profileId,
    modelName: activeProfile?.name || DEFAULT_PROFILE_NAME,
    modelProfiles: await getModelProfileStatuses(context, profiles),
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
    "Set the model profile, endpoint, API key and Channel ID to use IAEDU.",
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
  const profiles = await getStoredModelProfiles(context);
  const selectedProfile = await chooseModelProfileForConfiguration(profiles);
  if (selectedProfile === undefined && profiles.length > 0) {
    return undefined;
  }

  const profileName = await vscode.window.showInputBox({
    title: "IAEDU model profile name",
    prompt: "A local name for this IAEDU model or agent configuration",
    value: selectedProfile?.name || DEFAULT_PROFILE_NAME,
    ignoreFocusOut: true,
  });
  if (!profileName?.trim()) {
    return undefined;
  }

  const endpoint = await vscode.window.showInputBox({
    title: "IAEDU endpoint",
    prompt: "IAEDU agent-chat endpoint",
    value: selectedProfile?.endpoint || "",
    ignoreFocusOut: true,
    placeHolder: "https://api.iaedu.pt/agent-chat/...",
  });
  if (!endpoint) {
    return undefined;
  }

  const existingApiKey = selectedProfile
    ? await getProfileApiKey(context, selectedProfile.id)
    : "";
  const apiKey = await vscode.window.showInputBox({
    title: "IAEDU API key",
    prompt: existingApiKey
      ? "Leave empty to keep the saved key. The key is stored in VS Code SecretStorage."
      : "The key is stored in VS Code SecretStorage",
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey && !existingApiKey) {
    return undefined;
  }

  const channelId = await vscode.window.showInputBox({
    title: "IAEDU Channel ID",
    prompt: "Channel ID value from the agent page",
    value: selectedProfile?.channelId || "",
    ignoreFocusOut: true,
  });
  if (!channelId) {
    return undefined;
  }

  return saveConnectionSettings(context, {
    profileId: selectedProfile?.id,
    profileName,
    endpoint,
    apiKey,
    channelId,
  });
}

export async function saveConnectionSettings(
  context: vscode.ExtensionContext,
  input: ConnectionSettingsInput,
): Promise<IaeduSettings | undefined> {
  const endpoint = input.endpoint.trim();
  const apiKey = input.apiKey?.trim();
  const channelId = input.channelId.trim();
  const requireApiKey = input.requireApiKey !== false;
  const requireComplete = input.requireComplete !== false;
  const profiles = await getStoredModelProfiles(context);
  const requestedProfileId = input.profileId?.trim();
  const existingProfile = requestedProfileId
    ? profiles.find((profile) => profile.id === requestedProfileId)
    : undefined;
  const profileName = (
    input.profileName ||
    existingProfile?.name ||
    DEFAULT_PROFILE_NAME
  ).trim();

  if (!profileName) {
    vscode.window.showWarningMessage("Enter a model profile name to use IAEDU.");
    return undefined;
  }

  if (requireComplete && !endpoint) {
    vscode.window.showWarningMessage("Enter the endpoint to use IAEDU.");
    return undefined;
  }

  if (requireComplete && !channelId) {
    vscode.window.showWarningMessage("Enter the Channel ID to use IAEDU.");
    return undefined;
  }

  const profileId = existingProfile
    ? existingProfile.id
    : createUniqueProfileId(requestedProfileId || profileName, profiles);
  const existingApiKey = await getProfileApiKey(context, profileId);
  if (requireApiKey && !apiKey && !existingApiKey) {
    vscode.window.showWarningMessage("Enter the API key to use IAEDU.");
    return undefined;
  }

  const profile: IaeduModelProfile = {
    id: profileId,
    name: profileName,
    endpoint,
    channelId,
  };
  const nextProfiles = upsertModelProfile(profiles, profile);
  const config = vscode.workspace.getConfiguration("iaedu");

  await config.update(
    MODEL_PROFILES_CONFIG,
    nextProfiles,
    vscode.ConfigurationTarget.Workspace,
  );
  await setActiveModelProfileConfig(config, profile);

  if (apiKey) {
    await context.secrets.store(apiKeySecret(profile.id), apiKey);
  }

  const next = await getSettings(context);
  if (requireApiKey && !next.apiKey) {
    vscode.window.showWarningMessage("Enter the API key to use IAEDU.");
    return undefined;
  }

  vscode.window.showInformationMessage(`IAEDU model saved: ${profile.name}.`);
  return next;
}

export async function selectModelProfile(
  context: vscode.ExtensionContext,
  profileId?: string,
  options: { silent?: boolean } = {},
): Promise<IaeduSettings | undefined> {
  const profiles = await getStoredModelProfiles(context);
  if (profiles.length === 0) {
    vscode.window.showWarningMessage("No IAEDU model profiles are configured.");
    return undefined;
  }

  let selectedProfileId = profileId?.trim();
  if (!selectedProfileId) {
    const pick = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.name,
        description: profile.channelId || undefined,
        detail: profile.endpoint || undefined,
        profile,
      })),
      {
        title: "Select IAEDU model",
        placeHolder: "Choose the model profile to use for new requests",
        ignoreFocusOut: true,
      },
    );
    selectedProfileId = pick?.profile.id;
  }

  if (!selectedProfileId) {
    return undefined;
  }

  const profile = profiles.find((item) => item.id === selectedProfileId);
  if (!profile) {
    vscode.window.showWarningMessage("The selected IAEDU model profile no longer exists.");
    return undefined;
  }

  await setActiveModelProfileConfig(
    vscode.workspace.getConfiguration("iaedu"),
    profile,
  );
  if (!options.silent) {
    vscode.window.showInformationMessage(`IAEDU model selected: ${profile.name}.`);
  }
  return getSettings(context);
}

export async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const settings = await getSettings(context);
  const apiKey = await vscode.window.showInputBox({
    title: "IAEDU API key",
    prompt: `The key is stored in VS Code SecretStorage for ${settings.modelName}.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) {
    return;
  }
  await context.secrets.store(apiKeySecret(settings.modelProfileId), apiKey.trim());
  vscode.window.showInformationMessage(`IAEDU API key saved for ${settings.modelName}.`);
}

export async function logout(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("iaedu");
  const profiles = await getStoredModelProfiles(context);

  await context.secrets.delete(LEGACY_API_KEY_SECRET);
  for (const profile of profiles) {
    await context.secrets.delete(apiKeySecret(profile.id));
  }

  await config.update(MODEL_PROFILES_CONFIG, [], vscode.ConfigurationTarget.Workspace);
  await config.update(ACTIVE_MODEL_PROFILE_CONFIG, "", vscode.ConfigurationTarget.Workspace);
  await config.update("endpoint", "", vscode.ConfigurationTarget.Workspace);
  await config.update("channelId", "", vscode.ConfigurationTarget.Workspace);
  startNewThread(context, LEGACY_PROFILE_ID);
  vscode.window.showInformationMessage("IAEDU signed out and model profiles were cleared.");
}

export async function setEndpoint(context: vscode.ExtensionContext): Promise<void> {
  const settings = await getSettings(context);
  const endpoint = await vscode.window.showInputBox({
    title: "IAEDU endpoint",
    prompt: `IAEDU agent-chat endpoint for ${settings.modelName}`,
    value: settings.endpoint,
    ignoreFocusOut: true,
  });
  if (!endpoint) {
    return;
  }
  await saveConnectionSettings(context, {
    profileId: settings.modelProfileId,
    profileName: settings.modelName,
    endpoint,
    channelId: settings.channelId,
    requireApiKey: false,
    requireComplete: false,
  });
}

export async function setChannelId(context: vscode.ExtensionContext): Promise<void> {
  const settings = await getSettings(context);
  const channelId = await vscode.window.showInputBox({
    title: "IAEDU Channel ID",
    prompt: `Channel ID value for ${settings.modelName}`,
    value: settings.channelId,
    ignoreFocusOut: true,
  });
  if (!channelId) {
    return;
  }
  await saveConnectionSettings(context, {
    profileId: settings.modelProfileId,
    profileName: settings.modelName,
    endpoint: settings.endpoint,
    channelId,
    requireApiKey: false,
    requireComplete: false,
  });
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
  const settings = await getSettings(context);
  const saved = await saveConnectionSettings(context, {
    profileId: values.IAEDU_MODEL_ID || settings.modelProfileId,
    profileName: values.IAEDU_MODEL_NAME || settings.modelName,
    endpoint: values.IAEDU_ENDPOINT || settings.endpoint,
    channelId: values.IAEDU_CHANNEL_ID || settings.channelId,
    apiKey: values.IAEDU_API_KEY,
    requireApiKey: false,
    requireComplete: false,
  });

  if (!saved) {
    return;
  }

  if (values.IAEDU_THREAD_ID) {
    await context.workspaceState.update(
      threadIdStateKey(saved.modelProfileId),
      values.IAEDU_THREAD_ID,
    );
  }

  vscode.window.showInformationMessage("IAEDU settings imported from .env.");
}

export function startNewThread(
  context: vscode.ExtensionContext,
  profileId?: string,
): string {
  const resolvedProfileId =
    profileId ||
    vscode.workspace
      .getConfiguration("iaedu")
      .get<string>(ACTIVE_MODEL_PROFILE_CONFIG, "")
      .trim() ||
    LEGACY_PROFILE_ID;
  const threadId = makeThreadId();
  context.workspaceState.update(threadIdStateKey(resolvedProfileId), threadId);
  return threadId;
}

export function getOrCreateThreadId(
  context: vscode.ExtensionContext,
  profileId = LEGACY_PROFILE_ID,
): string {
  const key = threadIdStateKey(profileId);
  const existing = context.workspaceState.get<string>(key);
  if (existing) {
    return existing;
  }

  return startNewThread(context, profileId);
}

function resolveActiveProfile(
  config: vscode.WorkspaceConfiguration,
  profiles: IaeduModelProfile[],
): IaeduModelProfile | undefined {
  const activeProfileId = config
    .get<string>(ACTIVE_MODEL_PROFILE_CONFIG, "")
    .trim();
  return (
    profiles.find((profile) => profile.id === activeProfileId) ||
    profiles[0] ||
    undefined
  );
}

async function chooseModelProfileForConfiguration(
  profiles: IaeduModelProfile[],
): Promise<IaeduModelProfile | null | undefined> {
  if (profiles.length === 0) {
    return null;
  }

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Add new model profile",
        description: "Create another saved IAEDU configuration",
        profile: null,
      },
      ...profiles.map((profile) => ({
        label: profile.name,
        description: profile.channelId || undefined,
        detail: profile.endpoint || undefined,
        profile,
      })),
    ],
    {
      title: "Configure IAEDU model",
      placeHolder: "Choose a saved model profile or create a new one",
      ignoreFocusOut: true,
    },
  );

  return pick?.profile;
}

async function getStoredModelProfiles(
  context: vscode.ExtensionContext,
): Promise<IaeduModelProfile[]> {
  const config = vscode.workspace.getConfiguration("iaedu");
  const profiles = normalizeModelProfiles(config.get<unknown>(MODEL_PROFILES_CONFIG, []));
  if (profiles.length > 0) {
    return profiles;
  }

  const legacyProfile = getLegacyModelProfile(config);
  const legacyApiKey = (await context.secrets.get(LEGACY_API_KEY_SECRET)) || "";
  if (legacyProfile.endpoint || legacyProfile.channelId || legacyApiKey) {
    return [legacyProfile];
  }

  return [];
}

function getLegacyModelProfile(
  config: vscode.WorkspaceConfiguration,
): IaeduModelProfile {
  return {
    id: LEGACY_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    endpoint: config.get<string>("endpoint", "").trim(),
    channelId: config.get<string>("channelId", "").trim(),
  };
}

async function getModelProfileStatuses(
  context: vscode.ExtensionContext,
  profiles: IaeduModelProfile[],
): Promise<IaeduModelProfileStatus[]> {
  return Promise.all(
    profiles.map(async (profile) => ({
      ...profile,
      hasApiKey: Boolean(await getProfileApiKey(context, profile.id)),
    })),
  );
}

async function setActiveModelProfileConfig(
  config: vscode.WorkspaceConfiguration,
  profile: IaeduModelProfile,
): Promise<void> {
  await config.update(
    ACTIVE_MODEL_PROFILE_CONFIG,
    profile.id,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update("endpoint", profile.endpoint, vscode.ConfigurationTarget.Workspace);
  await config.update("channelId", profile.channelId, vscode.ConfigurationTarget.Workspace);
}

async function getProfileApiKey(
  context: vscode.ExtensionContext,
  profileId: string,
): Promise<string> {
  return (await context.secrets.get(apiKeySecret(profileId))) || "";
}

function apiKeySecret(profileId: string): string {
  return profileId === LEGACY_PROFILE_ID
    ? LEGACY_API_KEY_SECRET
    : `${API_KEY_SECRET_PREFIX}${profileId}`;
}

function threadIdStateKey(profileId: string): string {
  return profileId === LEGACY_PROFILE_ID
    ? LEGACY_THREAD_ID_STATE
    : `${THREAD_ID_STATE_PREFIX}${profileId}`;
}

function upsertModelProfile(
  profiles: IaeduModelProfile[],
  nextProfile: IaeduModelProfile,
): IaeduModelProfile[] {
  const existingIndex = profiles.findIndex((profile) => profile.id === nextProfile.id);
  if (existingIndex === -1) {
    return [...profiles, nextProfile];
  }

  return profiles.map((profile, index) =>
    index === existingIndex ? nextProfile : profile,
  );
}

function normalizeModelProfiles(value: unknown): IaeduModelProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: IaeduModelProfile[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as {
      id?: unknown;
      name?: unknown;
      endpoint?: unknown;
      channelId?: unknown;
    };
    const id = normalizeText(candidate.id);
    if (!id || seen.has(id)) {
      continue;
    }

    profiles.push({
      id,
      name: normalizeText(candidate.name) || id,
      endpoint: normalizeText(candidate.endpoint),
      channelId: normalizeText(candidate.channelId),
    });
    seen.add(id);
  }

  return profiles;
}

function createUniqueProfileId(
  value: string,
  profiles: IaeduModelProfile[],
): string {
  const existingIds = new Set(profiles.map((profile) => profile.id));
  const baseId = normalizeProfileId(value) || "model";
  let candidate = baseId;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function normalizeProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
