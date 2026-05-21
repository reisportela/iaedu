import { exec } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

export type LocalAction =
  | {
      type: "replaceSelection";
      content: string;
      title?: string;
    }
  | {
      type: "writeFile";
      path: string;
      content: string;
      title?: string;
    }
  | {
      type: "runCommand";
      command: string;
      cwd?: string;
      title?: string;
    };

export interface ApplyLocalActionOptions {
  autoAccept?: boolean;
}

export interface ApplyLocalActionResult {
  status: "applied" | "skipped" | "blocked";
  message: string;
}

const MAX_AUTO_WRITE_BYTES = 200_000;
const MAX_AUTO_COMMAND_CHARS = 180;

export function parseLocalActions(text: string): LocalAction[] {
  const actions: LocalAction[] = [];
  const blockPattern = /```(?:iaedu-action|iaedu-actions)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(text)) !== null) {
    const parsed = parseActionJson(match[1]);
    actions.push(...parsed);
  }

  return actions;
}

export async function applyLocalAction(
  action: LocalAction,
  output: vscode.OutputChannel,
  options: ApplyLocalActionOptions = {},
): Promise<ApplyLocalActionResult> {
  if (action.type === "replaceSelection") {
    return replaceSelection(action, options);
  }

  if (action.type === "writeFile") {
    return writeWorkspaceFile(action, options);
  }

  if (action.type === "runCommand") {
    return runCommand(action, output, options);
  }

  return { status: "blocked", message: "Unknown local action." };
}

function parseActionJson(text: string): LocalAction[] {
  try {
    const value = JSON.parse(text);
    const rawActions = Array.isArray(value) ? value : value.actions;
    if (!Array.isArray(rawActions)) {
      return [];
    }

    return rawActions.filter(isLocalAction);
  } catch {
    return [];
  }
}

function isLocalAction(value: unknown): value is LocalAction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "replaceSelection") {
    return typeof candidate.content === "string";
  }
  if (candidate.type === "writeFile") {
    return (
      typeof candidate.path === "string" &&
      typeof candidate.content === "string"
    );
  }
  if (candidate.type === "runCommand") {
    return typeof candidate.command === "string";
  }

  return false;
}

async function replaceSelection(
  action: Extract<LocalAction, { type: "replaceSelection" }>,
  options: ApplyLocalActionOptions,
): Promise<ApplyLocalActionResult> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("There is no active editor for replacing a selection.");
    return { status: "blocked", message: "No active editor for replacing a selection." };
  }

  if (Buffer.byteLength(action.content, "utf8") > MAX_AUTO_WRITE_BYTES) {
    if (options.autoAccept) {
      return {
        status: "skipped",
        message: "Auto-accept skipped a replacement that was too large.",
      };
    }
  }

  if (options.autoAccept) {
    if (editor.selection.isEmpty) {
      return {
        status: "skipped",
        message: "Auto-accept does not replace an empty selection.",
      };
    }

    const relativePath = getWorkspaceRelativePath(editor.document.uri);
    if (relativePath && needsProtectedPathConfirmation(relativePath)) {
      return {
        status: "skipped",
        message: `Auto-accept requires review for a sensitive file: ${relativePath}`,
      };
    }
  } else {
    const answer = await vscode.window.showWarningMessage(
      action.title || "Replace the current selection with the proposed content?",
      { modal: true },
      "Apply",
    );
    if (answer !== "Apply") {
      return { status: "skipped", message: "Local action cancelled." };
    }
  }

  await editor.edit((edit) => {
    edit.replace(editor.selection, action.content);
  });
  return { status: "applied", message: "Selection replaced." };
}

async function writeWorkspaceFile(
  action: Extract<LocalAction, { type: "writeFile" }>,
  options: ApplyLocalActionOptions,
): Promise<ApplyLocalActionResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace before writing files.");
    return { status: "blocked", message: "No workspace open for writing files." };
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const targetPath = path.resolve(workspaceRoot, action.path);
  const relative = path.relative(workspaceRoot, targetPath);
  const normalizedRelative = relative.split(path.sep).join("/");

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    vscode.window.showErrorMessage("The action tried to write outside the workspace.");
    return { status: "blocked", message: "Writing outside the workspace was blocked." };
  }

  if (isBlockedWritePath(normalizedRelative)) {
    vscode.window.showErrorMessage(
      `IAEDU blocked writing to a protected path: ${normalizedRelative}`,
    );
    return {
      status: "blocked",
      message: `Writing to a protected path was blocked: ${normalizedRelative}`,
    };
  }

  if (options.autoAccept) {
    if (needsProtectedPathConfirmation(normalizedRelative)) {
      return {
        status: "skipped",
        message: `Auto-accept requires review for a sensitive file: ${normalizedRelative}`,
      };
    }
    if (Buffer.byteLength(action.content, "utf8") > MAX_AUTO_WRITE_BYTES) {
      return {
        status: "skipped",
        message: `Auto-accept skipped a large write: ${normalizedRelative}`,
      };
    }
  }

  if (!options.autoAccept) {
    const answer = await vscode.window.showWarningMessage(
      action.title || `Write ${normalizedRelative}?`,
      { modal: true },
      "Apply",
    );
    if (answer !== "Apply") {
      return { status: "skipped", message: "Local action cancelled." };
    }

    if (needsProtectedPathConfirmation(normalizedRelative)) {
      const protectedAnswer = await vscode.window.showWarningMessage(
        `Confirm writing to a sensitive file: ${normalizedRelative}`,
        { modal: true },
        "Confirm",
      );
      if (protectedAnswer !== "Confirm") {
        return { status: "skipped", message: "Local action cancelled." };
      }
    }
  }

  const uri = vscode.Uri.file(targetPath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetPath)));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(action.content, "utf8"));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return { status: "applied", message: `File written: ${normalizedRelative}` };
}

async function runCommand(
  action: Extract<LocalAction, { type: "runCommand" }>,
  output: vscode.OutputChannel,
  options: ApplyLocalActionOptions,
): Promise<ApplyLocalActionResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
  const cwd = action.cwd ? path.resolve(workspaceRoot, action.cwd) : workspaceRoot;

  if (path.relative(workspaceRoot, cwd).startsWith("..")) {
    vscode.window.showErrorMessage("The action tried to run outside the workspace.");
    return { status: "blocked", message: "Command outside the workspace was blocked." };
  }

  if (isBlockedCommand(action.command)) {
    vscode.window.showErrorMessage(
      "IAEDU blocked this command because it appears destructive or unsafe.",
    );
    return { status: "blocked", message: "Command blocked by guardrails." };
  }

  if (options.autoAccept) {
    if (!isAutoAcceptCommand(action.command)) {
      return {
        status: "skipped",
        message: "Auto-accept requires review for this command.",
      };
    }
    if (action.command.length > MAX_AUTO_COMMAND_CHARS) {
      return {
        status: "skipped",
        message: "Auto-accept skipped a command that was too long.",
      };
    }
  } else {
    const answer = await vscode.window.showWarningMessage(
      action.title || `Run command?\n${action.command}`,
      { modal: true },
      "Run",
    );
    if (answer !== "Run") {
      return { status: "skipped", message: "Local action cancelled." };
    }
  }

  output.show(true);
  output.appendLine(`$ ${action.command}`);

  await new Promise<void>((resolve) => {
    const child = exec(action.command, { cwd }, (error, stdout, stderr) => {
      if (stdout) {
        output.append(stdout);
      }
      if (stderr) {
        output.append(stderr);
      }
      if (error) {
        output.appendLine(`\nExit: ${error.message}`);
      }
      resolve();
    });

    child.on("error", (error) => {
      output.appendLine(error.message);
      resolve();
    });
  });
  return { status: "applied", message: `Command run: ${action.command}` };
}

function isBlockedWritePath(relativePath: string): boolean {
  return (
    relativePath === ".git" ||
    relativePath.startsWith(".git/") ||
    relativePath === ".ssh" ||
    relativePath.startsWith(".ssh/")
  );
}

function needsProtectedPathConfirmation(relativePath: string): boolean {
  return (
    relativePath === ".env" ||
    relativePath.startsWith(".env.") ||
    relativePath.endsWith("/.env") ||
    relativePath.includes("/.env.") ||
    relativePath.startsWith(".vscode/") ||
    relativePath.startsWith(".github/")
  );
}

function isBlockedCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const blockedPatterns = [
    /\brm\s+-[^\n;|&]*r[^\n;|&]*f\b/,
    /\brm\s+-[^\n;|&]*f[^\n;|&]*r\b/,
    /\bsudo\b/,
    /\b(apt|apt-get|dnf|yum|pacman|zypper|brew|snap|flatpak)\s+(install|remove|erase|upgrade|update)\b/,
    /\b(systemctl|service|launchctl)\b/,
    /\bgit\s+push\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+-[^\n;|&]*f\b/,
    /\b(curl|wget)\b[\s\S]*\|\s*(sh|bash)\b/,
    /\bchmod\s+-r\b/,
    /\bchown\s+-r\b/,
  ];

  return blockedPatterns.some((pattern) => pattern.test(normalized));
}

function isAutoAcceptCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const allowPatterns = [
    /^npm\s+(test|run\s+(test|lint|typecheck|compile|build))\b/,
    /^pnpm\s+(test|run\s+(test|lint|typecheck|compile|build))\b/,
    /^yarn\s+(test|run\s+(test|lint|typecheck|compile|build))\b/,
    /^node\s+--test\b/,
    /^npx\s+tsc\b/,
    /^pytest\b/,
    /^python3?\s+-m\s+pytest\b/,
  ];

  return allowPatterns.some((pattern) => pattern.test(normalized));
}

function getWorkspaceRelativePath(uri: vscode.Uri): string | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return undefined;
  }

  const relative = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}
