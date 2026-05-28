import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_MODEL_CONFIG_PATH = "~/.secrets/IAEDU.md";

export interface ModelConfigFileEntry {
  id: string;
  name: string;
  endpoint: string;
  channelId: string;
  apiKey: string;
}

interface PartialModelConfigFileEntry {
  id?: string;
  name?: string;
  endpoint?: string;
  channelId?: string;
  apiKey?: string;
}

type ConfigField = keyof PartialModelConfigFileEntry;

const FIELD_NAMES: Record<string, ConfigField> = {
  id: "id",
  modelid: "id",
  profileid: "id",
  name: "name",
  model: "name",
  modelname: "name",
  profilename: "name",
  displayname: "name",
  endpoint: "endpoint",
  url: "endpoint",
  apiendpoint: "endpoint",
  agentchatendpoint: "endpoint",
  apikey: "apiKey",
  key: "apiKey",
  token: "apiKey",
  channel: "channelId",
  channelid: "channelId",
};

export function resolveModelConfigPath(value = DEFAULT_MODEL_CONFIG_PATH): string {
  const trimmed = value.trim() || DEFAULT_MODEL_CONFIG_PATH;
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export function parseModelConfigFile(text: string): ModelConfigFileEntry[] {
  const entries: ModelConfigFileEntry[] = [];
  const seenIds = new Set<string>();
  let current: PartialModelConfigFileEntry = {};

  const flush = () => {
    const normalized = normalizeEntry(current, seenIds);
    if (normalized) {
      entries.push(normalized);
      seenIds.add(normalized.id);
    }
    current = {};
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = findSeparatorIndex(trimmed);
    if (separatorIndex === -1) {
      continue;
    }

    const field = FIELD_NAMES[normalizeKey(trimmed.slice(0, separatorIndex))];
    if (!field) {
      continue;
    }

    if (field === "name" && hasEntryData(current) && current.name) {
      flush();
    }

    current[field] = unquoteValue(trimmed.slice(separatorIndex + 1).trim());
  }

  flush();
  return entries;
}

export function serializeModelConfigFile(entries: ModelConfigFileEntry[]): string {
  const blocks = entries.map((entry) =>
    [
      `Model_Name=${oneLine(entry.name)}`,
      `Endpoint=${oneLine(entry.endpoint)}`,
      `API_KEY=${oneLine(entry.apiKey)}`,
      `Channel_ID=${oneLine(entry.channelId)}`,
    ].join("\n"),
  );
  return `${blocks.join("\n\n")}\n`;
}

export function readModelConfigFile(filePath: string): ModelConfigFileEntry[] {
  const resolvedPath = resolveModelConfigPath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }
  return parseModelConfigFile(fs.readFileSync(resolvedPath, "utf8"));
}

export function writeModelConfigFile(
  filePath: string,
  entries: ModelConfigFileEntry[],
): void {
  const resolvedPath = resolveModelConfigPath(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolvedPath, serializeModelConfigFile(entries), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(resolvedPath, 0o600);
  } catch {
    // Best effort only. Some filesystems do not support POSIX permissions.
  }
}

export function upsertModelConfigFileEntry(
  entries: ModelConfigFileEntry[],
  nextEntry: ModelConfigFileEntry,
): ModelConfigFileEntry[] {
  const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (existingIndex === -1) {
    return [...entries, nextEntry];
  }

  return entries.map((entry, index) =>
    index === existingIndex ? nextEntry : entry,
  );
}

function normalizeEntry(
  value: PartialModelConfigFileEntry,
  seenIds: Set<string>,
): ModelConfigFileEntry | undefined {
  if (!hasEntryData(value)) {
    return undefined;
  }

  const name =
    normalizeText(value.name) ||
    normalizeText(value.id) ||
    normalizeText(value.channelId) ||
    "IAEDU model";
  const id = createUniqueProfileId(
    normalizeText(value.id) || name,
    seenIds,
  );

  return {
    id,
    name,
    endpoint: normalizeText(value.endpoint),
    channelId: normalizeText(value.channelId),
    apiKey: normalizeText(value.apiKey),
  };
}

function createUniqueProfileId(value: string, seenIds: Set<string>): string {
  const baseId = normalizeProfileId(value) || "model";
  let candidate = baseId;
  let suffix = 2;

  while (seenIds.has(candidate)) {
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

function hasEntryData(value: PartialModelConfigFileEntry): boolean {
  return Boolean(
    value.id || value.name || value.endpoint || value.channelId || value.apiKey,
  );
}

function findSeparatorIndex(value: string): number {
  const equalsIndex = value.indexOf("=");
  const colonIndex = value.indexOf(":");
  if (equalsIndex === -1) {
    return colonIndex;
  }
  if (colonIndex === -1) {
    return equalsIndex;
  }
  return Math.min(equalsIndex, colonIndex);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unquoteValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function oneLine(value: string): string {
  return normalizeText(value).replace(/\s*\r?\n\s*/g, " ");
}
