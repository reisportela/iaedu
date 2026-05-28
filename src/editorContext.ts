import * as path from "node:path";
import * as vscode from "vscode";

export interface EditorContextResult {
  text: string;
  userContext: Record<string, unknown>;
}

export type IaeduMode = "ask" | "plan" | "agent";

const MAX_WORKSPACE_OVERVIEW_FILES = 350;
const WORKSPACE_OVERVIEW_EXCLUDE = [
  "**/.git/**",
  "**/.vscode/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/.env",
  "**/.env.*",
  "**/*.vsix",
  "**/*.bak",
  "**/*.log",
  "**/*.dta",
  "**/*.gph",
  "**/*.parquet",
  "**/*.rds",
  "**/*.rdata",
  "**/*.sas7bdat",
  "**/*.sav",
  "**/*.zip",
].join(",");

export function getEditorContext(
  mode: "selection" | "activeFile",
  maxChars: number,
): EditorContextResult | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const document = editor.document;
  const selectionText = editor.selection.isEmpty
    ? ""
    : document.getText(editor.selection);
  const useSelection = mode === "selection" && selectionText.trim().length > 0;
  const text = useSelection ? selectionText : document.getText();
  const truncated = truncateMiddle(text, maxChars);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
    : document.uri.fsPath;

  return {
    text: [
      "",
      "Local VS Code context:",
      `File: ${relativePath}`,
      `Language: ${document.languageId}`,
      useSelection ? "Context type: selection" : "Context type: active file",
      "",
      "```",
      truncated,
      "```",
      "",
    ].join("\n"),
    userContext: {
      source: "vscode-extension",
      file: relativePath,
      languageId: document.languageId,
      contextMode: useSelection ? "selection" : "activeFile",
      truncated: truncated.length < text.length,
    },
  };
}

export async function getWorkspaceInstructions(
  maxChars: number,
): Promise<EditorContextResult | undefined> {
  const workspaceFolder = getInstructionWorkspaceFolder();
  if (!workspaceFolder) {
    return undefined;
  }

  const instructionUri = vscode.Uri.joinPath(workspaceFolder.uri, "IAEDU.md");
  let fileBytes: Uint8Array;
  try {
    fileBytes = await vscode.workspace.fs.readFile(instructionUri);
  } catch {
    return undefined;
  }

  const text = Buffer.from(fileBytes).toString("utf8").trim();
  if (!text) {
    return undefined;
  }

  const truncated = truncateMiddle(text, maxChars);
  return {
    text: [
      "Local project instructions from IAEDU.md:",
      "Apply these workspace-local instructions to this request.",
      "Do not propose local actions just to read IAEDU.md; it has already been supplied.",
      "",
      "```markdown",
      truncated,
      "```",
      "",
    ].join("\n"),
    userContext: {
      workspaceInstructionsFile: "IAEDU.md",
      workspaceInstructionsWorkspace: workspaceFolder.name,
      workspaceInstructionsTruncated: truncated.length < text.length,
    },
  };
}

export async function getWorkspaceOverview(
  maxChars: number,
): Promise<EditorContextResult | undefined> {
  const workspaceFolder = getInstructionWorkspaceFolder();
  if (!workspaceFolder) {
    return undefined;
  }

  const include = new vscode.RelativePattern(workspaceFolder, "**/*");
  const exclude = new vscode.RelativePattern(
    workspaceFolder,
    `{${WORKSPACE_OVERVIEW_EXCLUDE}}`,
  );
  let fileUris: vscode.Uri[];
  try {
    fileUris = await vscode.workspace.findFiles(
      include,
      exclude,
      MAX_WORKSPACE_OVERVIEW_FILES + 1,
    );
  } catch {
    return undefined;
  }

  const truncatedFiles = fileUris.length > MAX_WORKSPACE_OVERVIEW_FILES;
  const files = fileUris
    .slice(0, MAX_WORKSPACE_OVERVIEW_FILES)
    .map((uri) =>
      path
        .relative(workspaceFolder.uri.fsPath, uri.fsPath)
        .split(path.sep)
        .join("/"),
    )
    .filter((relativePath) => relativePath && !relativePath.startsWith(".."))
    .sort();

  if (files.length === 0) {
    return undefined;
  }

  const text = [
    "Local workspace overview:",
    `Workspace: ${workspaceFolder.name}`,
    "This is a bounded file-path overview supplied for folder-level agent requests.",
    "It lists paths only, not file contents. Sensitive local files, large data files, build outputs and dependency folders are excluded.",
    "",
    "```text",
    ...files,
    truncatedFiles ? "[... file list truncated ...]" : "",
    "```",
    "",
  ].join("\n");
  const truncated = truncateMiddle(text, Math.min(maxChars, 12000));

  return {
    text: truncated,
    userContext: {
      workspaceOverviewWorkspace: workspaceFolder.name,
      workspaceOverviewFiles: files.length,
      workspaceOverviewFileListTruncated: truncatedFiles,
      workspaceOverviewTextTruncated: truncated.length < text.length,
    },
  };
}

export function shouldIncludeWorkspaceOverview(
  userPrompt: string,
  mode: IaeduMode,
): boolean {
  if (mode !== "agent") {
    return false;
  }

  const normalized = normalizeForIntent(userPrompt);
  const mentionsFolder = /\b(folder|directory|workspace|repo|repository|project|pasta|diretorio|directorio|repositorio|projeto)\b/.test(
    normalized,
  );
  const asksForFolderWork = /\b(study|analyse|analyze|inspect|describe|document|summarize|map|estuda|analisa|descreve|documenta|resume|mapeia)\b/.test(
    normalized,
  );
  const asksForNotes = /\bnotas\s*md\b|\bnotes\s*md\b|\breadme\s*md\b/.test(
    normalized,
  );

  return mentionsFolder || (asksForFolderWork && asksForNotes);
}

export function buildPrompt(
  userPrompt: string,
  contextText?: string,
  mode: IaeduMode = "ask",
  workspaceInstructionText?: string,
  workspaceOverviewText?: string,
  codexSkillText?: string,
): string {
  const parts = [MODE_INSTRUCTIONS[mode]];
  if (workspaceInstructionText) {
    parts.push(workspaceInstructionText);
  }
  if (workspaceOverviewText) {
    parts.push(workspaceOverviewText);
  }
  if (codexSkillText) {
    parts.push(codexSkillText);
  }
  parts.push(userPrompt.trim());
  if (contextText) {
    parts.push(contextText);
  }
  return parts.join("\n\n");
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

function getInstructionWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (activeFolder) {
      return activeFolder;
    }
  }

  return vscode.workspace.workspaceFolders?.[0];
}

function normalizeForIntent(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MODE_INSTRUCTIONS: Record<IaeduMode, string> = {
  ask: [
    "IAEDU/VS Code ASK mode.",
    "Answer the user's question directly and usefully.",
    "You may use the supplied local context, but do not propose executable local actions or iaedu-action blocks.",
  ].join("\n"),
  plan: [
    "IAEDU/VS Code PLAN mode.",
    "Work read-only: analyse the context, identify risks, and propose an execution plan.",
    "Do not propose edits or executable commands in iaedu-action blocks.",
    "When the task involves code, finish with concrete implementation and validation steps for the user to run or approve in Agent mode.",
  ].join("\n"),
  agent: [
    "IAEDU/VS Code local AGENT mode.",
    "You may help analyse, edit files, and propose commands, but local execution is always handled by the extension guardrails and user settings.",
    "When you want to propose a local action, include a fenced block whose language is exactly iaedu-action.",
    "Supported format:",
    "```iaedu-action",
    "{\"actions\":[{\"type\":\"writeFile\",\"path\":\"relative/path.txt\",\"content\":\"...\"},{\"type\":\"appendFile\",\"path\":\"script.do\",\"content\":\"...\"},{\"type\":\"replaceSelection\",\"content\":\"...\"},{\"type\":\"runCommand\",\"command\":\"npm test\"}]}",
    "```",
    "If the user asks you to create, write, save, update or generate a workspace file, you must include a writeFile or appendFile action. Do not merely provide file content in chat for the user to copy manually.",
    "For folder-level documentation requests such as creating NOTAS.md, use the supplied workspace overview and available context, then write the requested file with writeFile. If the overview is incomplete, create a useful draft that states its limits.",
    "Use paths relative to the workspace. For small additions to existing text files, such as adding a Stata regression to a .do file, use appendFile instead of a shell or Python command that edits the file. Prefer runCommand only for validation commands such as tests, builds, Stata batch do-files or workspace scripts. Do not propose destructive commands. Outside that block, briefly explain why the action is proposed.",
  ].join("\n"),
};
