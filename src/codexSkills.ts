import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_CODEX_SKILLS_PATH = "~/.codex/skills";
export const DEFAULT_CODEX_EXTRA_SKILLS_PATHS = [
  "~/Documents/AI/skills/skills_portela",
];
export const DEFAULT_CODEX_PLUGIN_SKILLS_PATH = "~/.codex/plugins/cache";

export interface CodexSkillSettings {
  enabled: boolean;
  skillsPath: string;
  extraPaths: string[];
  includePluginSkills: boolean;
  maxSkills: number;
  maxChars: number;
}

export interface CodexSkill {
  name: string;
  description: string;
  filePath: string;
  source: string;
  body: string;
}

export interface CodexSkillContext {
  text: string;
  userContext: {
    codexSkillsEnabled: boolean;
    codexSkillsPath: string;
    codexSkillsExtraPaths: string[];
    codexSkillsIncludePluginSkills: boolean;
    codexSkillsAvailable: number;
    codexSkillsSelected: string[];
    codexSkillsTruncated: boolean;
  };
}

interface RankedCodexSkill {
  skill: CodexSkill;
  score: number;
}

const MAX_DISCOVERED_SKILLS = 200;
const MAX_DESCRIPTION_CHARS = 260;
const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "com",
  "como",
  "das",
  "dos",
  "for",
  "from",
  "into",
  "para",
  "por",
  "que",
  "sem",
  "sobre",
  "the",
  "this",
  "uma",
  "use",
  "usar",
  "with",
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  artigo: ["paper", "manuscript"],
  capitulo: ["chapter"],
  dados: ["data"],
  dado: ["data"],
  descritivas: ["descriptive", "statistics"],
  doutoramento: ["phd", "thesis"],
  econometria: ["econometric"],
  econometrica: ["econometric"],
  empirica: ["empirical"],
  estrategia: ["strategy"],
  literatura: ["literature"],
  manuscrito: ["manuscript"],
  metodologia: ["methods"],
  orientador: ["supervisor"],
  orientadora: ["supervisor"],
  pdf: ["pdf"],
  renomear: ["rename"],
  relatorio: ["report", "review"],
  resultados: ["results"],
  revisao: ["review"],
  rever: ["review"],
  reve: ["review"],
  secao: ["section"],
  seccao: ["section"],
  tese: ["thesis"],
};

export function getCodexSkillContext(
  userPrompt: string,
  settings: CodexSkillSettings,
): CodexSkillContext | undefined {
  if (!settings.enabled) {
    return undefined;
  }

  const skills = discoverCodexSkills(settings);
  if (skills.length === 0) {
    return undefined;
  }

  const maxChars = clampInteger(settings.maxChars, 1000, 50000, 20000);
  const maxSkills = clampInteger(settings.maxSkills, 1, 10, 3);
  const ranked = rankCodexSkills(skills, userPrompt);
  const selected = ranked
    .filter((item) => item.score > 0)
    .slice(0, maxSkills)
    .map((item) => item.skill);
  const text = buildCodexSkillText(skills, selected, maxChars);

  return {
    text,
    userContext: {
      codexSkillsEnabled: true,
      codexSkillsPath: settings.skillsPath,
      codexSkillsExtraPaths: settings.extraPaths,
      codexSkillsIncludePluginSkills: settings.includePluginSkills,
      codexSkillsAvailable: skills.length,
      codexSkillsSelected: selected.map((skill) => skill.name),
      codexSkillsTruncated: text.length >= maxChars,
    },
  };
}

export function discoverCodexSkills(
  settings: Pick<
    CodexSkillSettings,
    "skillsPath" | "extraPaths" | "includePluginSkills"
  >,
): CodexSkill[] {
  const roots: Array<{ path: string; priority: number }> = [
    { path: settings.skillsPath, priority: 10 },
    ...(settings.extraPaths || []).map((root) => ({ path: root, priority: 20 })),
  ];
  if (settings.includePluginSkills) {
    roots.push({ path: DEFAULT_CODEX_PLUGIN_SKILLS_PATH, priority: 5 });
  }

  const seen = new Set<string>();
  const skillsByName = new Map<string, { skill: CodexSkill; priority: number }>();
  for (const root of roots) {
    for (const filePath of findSkillFiles(resolveCodexPath(root.path))) {
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      try {
        const body = fs.readFileSync(filePath, "utf8").trim();
        if (body) {
          const skill = parseCodexSkillFile(filePath, body);
          const key = normalizeForMatch(skill.name);
          const existing = skillsByName.get(key);
          if (!existing || root.priority >= existing.priority) {
            skillsByName.set(key, { skill, priority: root.priority });
          }
        }
      } catch {
        // Ignore unreadable local skills; the extension should not fail a chat.
      }
    }
  }

  return Array.from(skillsByName.values())
    .map((item) => item.skill)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function parseCodexSkillFile(filePath: string, body: string): CodexSkill {
  const fields = parseFrontmatter(body);
  const fallbackName = path.basename(path.dirname(filePath));
  const name = oneLine(fields.name || fallbackName) || fallbackName;
  const description =
    oneLine(fields.description || firstMarkdownParagraph(body)) ||
    "Local Codex skill.";

  return {
    name,
    description,
    filePath,
    source: displayPath(filePath),
    body,
  };
}

function buildCodexSkillText(
  skills: CodexSkill[],
  selected: CodexSkill[],
  maxChars: number,
): string {
  const available = skills.map(
    (skill) =>
      `- ${skill.name}: ${truncateEnd(skill.description, MAX_DESCRIPTION_CHARS)}`,
  );
  const selectedBlocks =
    selected.length > 0
      ? selected.map(formatSelectedSkill)
      : [
          "No full Codex skill body was selected by the local matcher for this request.",
          "Use the available-skills index only as a map of possible capabilities; ask for an exact skill if needed.",
        ].join("\n");

  const text = [
    "Local Codex skills context:",
    "The user enabled Codex skills for this IAEDU request.",
    "These are local Codex SKILL.md instructions. Apply them only when relevant to the user request.",
    "Use the skill text as behavioural guidance; do not quote it unless the user explicitly asks for the skill content.",
    "This extension supplies SKILL.md text only. It does not expose Codex tools, MCP servers, scripts, assets, or files outside the VS Code workspace.",
    "Any local action must still use IAEDU action blocks and remain inside the existing extension guardrails.",
    "",
    "Available Codex skills:",
    ...available,
    "",
    "Selected Codex skill instructions:",
    selectedBlocks,
    "",
  ].join("\n");

  return truncateMiddle(text, maxChars);
}

function formatSelectedSkill(skill: CodexSkill): string {
  return [
    `Codex skill: ${skill.name}`,
    `Source: ${skill.source}`,
    "",
    "```markdown",
    skill.body,
    "```",
  ].join("\n");
}

function rankCodexSkills(
  skills: CodexSkill[],
  userPrompt: string,
): RankedCodexSkill[] {
  const promptText = normalizeForMatch(userPrompt);
  const queryTokens = tokenizeWithSynonyms(userPrompt);

  return skills
    .map((skill) => {
      const nameText = normalizeForMatch(skill.name);
      const nameTokens = tokenizeWithSynonyms(skill.name);
      const descriptionTokens = tokenizeWithSynonyms(skill.description);
      let score = 0;

      if (promptText.includes(`$${nameText}`) || promptText.includes(nameText)) {
        score += 120;
      }

      for (const token of queryTokens) {
        if (nameTokens.has(token)) {
          score += 8;
        }
        if (descriptionTokens.has(token)) {
          score += 3;
        }
      }

      return { skill, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.skill.name.localeCompare(right.skill.name);
    });
}

function findSkillFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const result: string[] = [];
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (pending.length > 0 && result.length < MAX_DISCOVERED_SKILLS) {
    const current = pending.pop();
    if (!current || current.depth > 8) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (result.length >= MAX_DISCOVERED_SKILLS) {
        break;
      }
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name === "SKILL.md") {
        result.push(entryPath);
      } else if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
        pending.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return result.sort();
}

function shouldSkipDirectory(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = unquote(line.slice(separator + 1).trim());
    if (key && value) {
      fields[key] = value;
    }
  }
  return fields;
}

function firstMarkdownParagraph(text: string): string {
  const withoutFrontmatter = text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---/, "");
  for (const block of withoutFrontmatter.split(/\n\s*\n/)) {
    const cleaned = block
      .replace(/^#+\s+/gm, "")
      .replace(/^[-*]\s+/gm, "")
      .trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return "";
}

function tokenizeWithSynonyms(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of normalizeForMatch(value).split(/\s+/)) {
    if (token.length < 3 || STOP_WORDS.has(token)) {
      continue;
    }
    tokens.add(token);
    for (const synonym of TOKEN_SYNONYMS[token] || []) {
      tokens.add(synonym);
    }
  }
  return tokens;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCodexPath(value: string): string {
  const expanded = expandEnvironment(value.trim() || DEFAULT_CODEX_SKILLS_PATH);
  if (expanded === "~") {
    return os.homedir();
  }
  if (expanded.startsWith("~/")) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  return path.resolve(expanded);
}

function expandEnvironment(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, name) => {
    return process.env[name] || match;
  });
}

function displayPath(filePath: string): string {
  const home = os.homedir();
  if (filePath === home) {
    return "~";
  }
  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, filePath)}`;
  }
  return filePath;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 15)).trimEnd()} [truncated]`;
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
