import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_PROMPT_FILE_MAX_CHARS = 80000;
export const DEFAULT_PROMPT_FILE_MAX_FILES = 4;

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_BUFFER_BYTES = 64 * 1024 * 1024;
const MIN_TEXT_CHARS = 1000;
const MAX_TEXT_CHARS = 500000;
const MIN_FILE_COUNT = 1;
const MAX_FILE_COUNT = 10;

const TEXT_EXTENSIONS = new Set([
  ".ado",
  ".bib",
  ".csv",
  ".do",
  ".jl",
  ".js",
  ".json",
  ".latex",
  ".md",
  ".mjs",
  ".py",
  ".qmd",
  ".r",
  ".rmd",
  ".tex",
  ".ts",
  ".txt",
]);

const SUPPORTED_EXTENSIONS = new Set([".pdf", ...TEXT_EXTENSIONS]);
const EXTENSION_PATTERN = Array.from(SUPPORTED_EXTENSIONS)
  .map((extension) => extension.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((left, right) => right.length - left.length)
  .join("|");

export interface PromptFileSettings {
  enabled: boolean;
  maxFiles: number;
  maxChars: number;
}

export interface PromptFileCandidate {
  rawPath: string;
  filePath: string;
}

export interface ReferencedFileContext {
  text: string;
  userContext: {
    promptFilesEnabled: boolean;
    promptFilesDetected: number;
    promptFilesIncluded: string[];
    promptFilesSkipped: string[];
    promptFilesTruncated: boolean;
  };
}

interface ReadReferencedFileResult {
  ok: boolean;
  text?: string;
  kind?: string;
  extractor?: string;
  skippedReason?: string;
  truncated?: boolean;
}

export async function getReferencedFileContext(
  userPrompt: string,
  settings: PromptFileSettings,
  workspaceFolders: string[] = [],
): Promise<ReferencedFileContext | undefined> {
  if (!settings.enabled) {
    return undefined;
  }

  const allCandidates = resolvePromptFileCandidates(userPrompt, workspaceFolders);
  if (allCandidates.length === 0) {
    return undefined;
  }

  const maxFiles = clampInteger(
    settings.maxFiles,
    MIN_FILE_COUNT,
    MAX_FILE_COUNT,
    DEFAULT_PROMPT_FILE_MAX_FILES,
  );
  const maxChars = clampInteger(
    settings.maxChars,
    MIN_TEXT_CHARS,
    MAX_TEXT_CHARS,
    DEFAULT_PROMPT_FILE_MAX_CHARS,
  );
  const candidates = allCandidates.slice(0, maxFiles);
  const sections: string[] = [];
  const included: string[] = [];
  const skipped: string[] = [];
  let remainingChars = maxChars;
  let truncated = allCandidates.length > candidates.length;

  for (const candidate of candidates) {
    if (remainingChars <= 0) {
      skipped.push(`${displayPath(candidate.filePath)}: context limit reached`);
      truncated = true;
      continue;
    }

    const result = await readReferencedFile(candidate.filePath, remainingChars);
    if (!result.ok) {
      skipped.push(
        `${displayPath(candidate.filePath)}: ${result.skippedReason || "not readable"}`,
      );
      continue;
    }

    const fileText = result.text || "";
    if (!fileText.trim()) {
      skipped.push(`${displayPath(candidate.filePath)}: no extractable text`);
      continue;
    }

    const excerpt = buildContextExcerpt(fileText, remainingChars, result.kind);
    const content = excerpt.text;
    remainingChars -= content.length;
    truncated =
      truncated ||
      Boolean(result.truncated) ||
      excerpt.excerpted ||
      content.length < fileText.length;
    included.push(displayPath(candidate.filePath));
    sections.push(formatReferencedFileSection(candidate, result, content));
  }

  if (sections.length === 0 && skipped.length === 0) {
    return undefined;
  }

  const text = [
    "Local referenced file context:",
    "The following context comes from files explicitly mentioned in the user's prompt.",
    "Use this source text as the evidence base for any requested report, review, summary, or file-writing task.",
    "Do not produce a generic answer detached from this supplied text. If relevant text is missing or truncated, say so explicitly.",
    "Response budget for long-document requests: unless the user explicitly asks for a longer deliverable, keep the final answer under about 2,000 words.",
    "For supervisor-style reports, prioritize the 6-8 highest-value findings and concrete revision advice over exhaustive page-by-page paraphrase.",
    "This response budget overrides longer default skill templates when a large referenced file is supplied.",
    "",
    ...sections,
    skipped.length > 0
      ? ["Skipped referenced files:", ...skipped.map((item) => `- ${item}`), ""].join("\n")
      : "",
  ].join("\n");

  return {
    text,
    userContext: {
      promptFilesEnabled: true,
      promptFilesDetected: allCandidates.length,
      promptFilesIncluded: included,
      promptFilesSkipped: skipped,
      promptFilesTruncated: truncated,
    },
  };
}

export function resolvePromptFileCandidates(
  userPrompt: string,
  workspaceFolders: string[] = [],
): PromptFileCandidate[] {
  const paths = findPromptPathReferences(userPrompt);
  const folders = workspaceFolders.map((folder) => path.resolve(folder));
  const seen = new Set<string>();
  const candidates: PromptFileCandidate[] = [];

  for (const rawPath of paths) {
    for (const filePath of resolveRawPromptPath(rawPath, folders)) {
      const normalized = path.normalize(filePath);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      candidates.push({ rawPath, filePath: normalized });
    }
  }

  return candidates;
}

export function findPromptPathReferences(userPrompt: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const cleaned = stripPathPunctuation(value.trim());
    if (!cleaned || seen.has(cleaned) || !isSupportedPath(cleaned)) {
      return;
    }
    seen.add(cleaned);
    result.push(cleaned);
  };

  const quotedPattern = new RegExp(
    '["\'`]([^"\'`\\r\\n]+\\.(' + EXTENSION_PATTERN + '))["\'`]',
    "gi",
  );
  for (const match of userPrompt.matchAll(quotedPattern)) {
    push(match[1]);
  }

  const absolutePattern = new RegExp(
    '(^|[\\s(\\[])((?:~|/)[^\\s"\'`<>)]*\\.(' +
      EXTENSION_PATTERN +
      '))(?:$|[\\s).,;:!?])',
    "gi",
  );
  for (const match of userPrompt.matchAll(absolutePattern)) {
    push(match[2]);
  }

  const relativePattern = new RegExp(
    '(^|[\\s(\\[])((?:\\.{1,2}/|[A-Za-z0-9_.-]+/)[^\\s"\'`<>)]*\\.(' +
      EXTENSION_PATTERN +
      '))(?:$|[\\s).,;:!?])',
    "gi",
  );
  for (const match of userPrompt.matchAll(relativePattern)) {
    push(match[2]);
  }

  const bareFilePattern = new RegExp(
    '(^|[\\s(\\[])([A-Za-z0-9_.-]+\\.(' +
      EXTENSION_PATTERN +
      '))(?:$|[\\s).,;:!?])',
    "gi",
  );
  for (const match of userPrompt.matchAll(bareFilePattern)) {
    push(match[2]);
  }

  return result;
}

async function readReferencedFile(
  filePath: string,
  maxChars: number,
): Promise<ReadReferencedFileResult> {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return { ok: false, skippedReason: "file not found" };
  }

  if (!stats.isFile()) {
    return { ok: false, skippedReason: "not a file" };
  }

  if (stats.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      skippedReason: `file is too large (${formatBytes(stats.size)})`,
    };
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    return readPdfText(filePath, maxChars);
  }

  if (!TEXT_EXTENSIONS.has(extension)) {
    return { ok: false, skippedReason: "unsupported file type" };
  }

  try {
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) {
      return { ok: false, skippedReason: "binary file" };
    }

    const text = normalizeExtractedText(buffer.toString("utf8"));
    return {
      ok: true,
      text,
      kind: extension.slice(1).toUpperCase(),
      extractor: "utf8",
      truncated: text.length > maxChars,
    };
  } catch {
    return { ok: false, skippedReason: "could not read file" };
  }
}

async function readPdfText(
  filePath: string,
  maxChars: number,
): Promise<ReadReferencedFileResult> {
  const maxBuffer = Math.min(
    MAX_PDF_BUFFER_BYTES,
    Math.max(4 * 1024 * 1024, maxChars * 4),
  );

  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", filePath, "-"],
      {
        encoding: "utf8",
        maxBuffer,
      },
    );
    const text = normalizeExtractedText(stdout);
    return {
      ok: true,
      text,
      kind: "PDF",
      extractor: "pdftotext",
      truncated: text.length > maxChars,
    };
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return { ok: false, skippedReason: "pdftotext is not available" };
    }
    return { ok: false, skippedReason: "could not extract PDF text" };
  }
}

function formatReferencedFileSection(
  candidate: PromptFileCandidate,
  result: ReadReferencedFileResult,
  content: string,
): string {
  const originalLength = (result.text || "").length;
  return [
    `Referenced file: ${displayPath(candidate.filePath)}`,
    `Prompt path: ${candidate.rawPath}`,
    `Type: ${result.kind || "text"}`,
    `Extractor: ${result.extractor || "unknown"}`,
    content.length < originalLength
      ? "Status: excerpted to fit request limits"
      : "Status: complete within configured limit",
    "",
    "```text",
    content,
    "```",
    "",
  ].join("\n");
}

function buildContextExcerpt(
  text: string,
  maxChars: number,
  kind?: string,
): { text: string; excerpted: boolean } {
  if (text.length <= maxChars) {
    return { text, excerpted: false };
  }

  if (kind === "PDF") {
    const pages = splitPdfPages(text);
    if (pages.length >= 4) {
      return {
        text: excerptPdfPages(pages, maxChars),
        excerpted: true,
      };
    }
  }

  return { text: truncateMiddle(text, maxChars), excerpted: true };
}

function splitPdfPages(text: string): string[] {
  return text
    .split(/\n\s*\[page break\]\s*\n/g)
    .map((page) => page.trim())
    .filter(Boolean);
}

function excerptPdfPages(pages: string[], maxChars: number): string {
  const intro = [
    `[Large PDF excerpt pack: ${pages.length} pages detected.]`,
    "Each page is represented by an extractive snippet to keep the API request stable.",
    "",
  ].join("\n");
  const availableChars = Math.max(0, maxChars - intro.length);
  const perPageChars = Math.max(
    400,
    Math.floor((availableChars - pages.length * 42) / pages.length),
  );
  const sections = pages.map((page, index) => {
    const pageText = truncateMiddle(page, perPageChars);
    return [`--- PDF page ${index + 1} of ${pages.length} ---`, pageText].join(
      "\n",
    );
  });

  return truncateEnd([intro, ...sections].join("\n\n"), maxChars);
}

function resolveRawPromptPath(rawPath: string, workspaceFolders: string[]): string[] {
  const expanded = expandPath(rawPath);
  if (path.isAbsolute(expanded)) {
    return [expanded];
  }

  return workspaceFolders.map((folder) => path.resolve(folder, expanded));
}

function expandPath(value: string): string {
  const expanded = value.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, name) => {
    return process.env[name] || match;
  });

  if (expanded === "~") {
    return os.homedir();
  }
  if (expanded.startsWith("~/")) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  return expanded;
}

function isSupportedPath(value: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function stripPathPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/g, "");
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n\n[page break]\n\n")
    .replace(/\u0000/g, "")
    .trim();
}

function displayPath(filePath: string): string {
  const home = os.homedir();
  if (filePath === home) {
    return "~";
  }
  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, filePath).split(path.sep).join("/")}`;
  }
  return filePath.split(path.sep).join("/");
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function clampInteger(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  return [
    text.slice(0, head),
    "",
    `[... omitted: ${text.length - maxChars} characters ...]`,
    "",
    text.slice(text.length - tail),
  ].join("\n");
}

function truncateEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const marker = "\n[... omitted to fit request limit ...]";
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}
