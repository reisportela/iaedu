import { exec } from "node:child_process";
import * as fs from "node:fs";
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
      type: "appendFile";
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
const MAX_AUTO_COMMAND_CHARS = 320;
const AUTO_APPEND_TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".do",
  ".h",
  ".html",
  ".jl",
  ".js",
  ".json",
  ".jsx",
  ".m",
  ".md",
  ".mjs",
  ".py",
  ".qmd",
  ".r",
  ".rmd",
  ".sh",
  ".sql",
  ".tex",
  ".ts",
  ".tsx",
  ".tsv",
  ".txt",
  ".yaml",
  ".yml",
]);

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

  if (action.type === "appendFile") {
    return appendWorkspaceFile(action, options);
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
  if (candidate.type === "appendFile") {
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
  const resolved = resolveWorkspaceTarget(action.path);
  if (resolved.result) {
    return resolved.result;
  }
  const { targetPath, normalizedRelative } = resolved.target;

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

async function appendWorkspaceFile(
  action: Extract<LocalAction, { type: "appendFile" }>,
  options: ApplyLocalActionOptions,
): Promise<ApplyLocalActionResult> {
  const resolved = resolveWorkspaceTarget(action.path);
  if (resolved.result) {
    return resolved.result;
  }
  const { targetPath, normalizedRelative } = resolved.target;
  const uri = vscode.Uri.file(targetPath);

  let current: string;
  try {
    current = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return {
      status: "blocked",
      message: `Append target not found: ${normalizedRelative}`,
    };
  }

  if (options.autoAccept) {
    if (needsProtectedPathConfirmation(normalizedRelative)) {
      return {
        status: "skipped",
        message: `Auto-accept requires review for a sensitive file: ${normalizedRelative}`,
      };
    }
    if (!isAutoAcceptTextAppendPath(normalizedRelative)) {
      return {
        status: "skipped",
        message: `Auto-accept requires review for this append target: ${normalizedRelative}`,
      };
    }
    if (Buffer.byteLength(action.content, "utf8") > MAX_AUTO_WRITE_BYTES) {
      return {
        status: "skipped",
        message: `Auto-accept skipped a large append: ${normalizedRelative}`,
      };
    }
  }

  if (!options.autoAccept) {
    const answer = await vscode.window.showWarningMessage(
      action.title || `Append to ${normalizedRelative}?`,
      { modal: true },
      "Append",
    );
    if (answer !== "Append") {
      return { status: "skipped", message: "Local action cancelled." };
    }

    if (needsProtectedPathConfirmation(normalizedRelative)) {
      const protectedAnswer = await vscode.window.showWarningMessage(
        `Confirm appending to a sensitive file: ${normalizedRelative}`,
        { modal: true },
        "Confirm",
      );
      if (protectedAnswer !== "Confirm") {
        return { status: "skipped", message: "Local action cancelled." };
      }
    }
  }

  const separator =
    current.length > 0 && !current.endsWith("\n") && !action.content.startsWith("\n")
      ? "\n"
      : "";
  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(`${current}${separator}${action.content}`, "utf8"),
  );
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return { status: "applied", message: `File appended: ${normalizedRelative}` };
}

async function runCommand(
  action: Extract<LocalAction, { type: "runCommand" }>,
  output: vscode.OutputChannel,
  options: ApplyLocalActionOptions,
): Promise<ApplyLocalActionResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
  const cwd = action.cwd ? path.resolve(workspaceRoot, action.cwd) : workspaceRoot;

  if (!isPathInside(workspaceRoot, cwd)) {
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
    if (!workspaceFolder) {
      return {
        status: "skipped",
        message: "Auto-accept requires an open workspace for commands.",
      };
    }
    if (!isAutoAcceptCommand(action.command, cwd, workspaceRoot)) {
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

type ResolvedWorkspaceTarget =
  | {
      target: {
        targetPath: string;
        normalizedRelative: string;
      };
      result?: undefined;
    }
  | {
      target?: undefined;
      result: ApplyLocalActionResult;
    };

function resolveWorkspaceTarget(relativePath: string): ResolvedWorkspaceTarget {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace before writing files.");
    return { result: { status: "blocked", message: "No workspace open for writing files." } };
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const targetPath = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, targetPath);
  const normalizedRelative = relative.split(path.sep).join("/");

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    vscode.window.showErrorMessage("The action tried to write outside the workspace.");
    return { result: { status: "blocked", message: "Writing outside the workspace was blocked." } };
  }

  if (isBlockedWritePath(normalizedRelative)) {
    vscode.window.showErrorMessage(
      `IAEDU blocked writing to a protected path: ${normalizedRelative}`,
    );
    return {
      result: {
        status: "blocked",
        message: `Writing to a protected path was blocked: ${normalizedRelative}`,
      },
    };
  }

  return { target: { targetPath, normalizedRelative } };
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

function isAutoAcceptTextAppendPath(relativePath: string): boolean {
  return AUTO_APPEND_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
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

function isAutoAcceptCommand(
  command: string,
  cwd: string,
  workspaceRoot: string,
): boolean {
  const trimmed = command.trim();
  if (!trimmed || hasUnsafeAutoAcceptShellSyntax(trimmed)) {
    return false;
  }

  const tokens = splitSimpleCommandLine(trimmed);
  if (!tokens || tokens.length === 0) {
    return false;
  }

  const normalized = trimmed.toLowerCase();
  const allowPatterns = [
    /^npm\s+(test|run\s+(test|lint|typecheck|compile|build))\b/,
    /^pnpm\s+(test|run\s+(test|lint|typecheck|compile|build))\b/,
    /^yarn\s+(test|run\s+(test|lint|typecheck|compile|build))\b/,
  ];

  return (
    allowPatterns.some((pattern) => pattern.test(normalized)) ||
    isAutoAcceptNodeCommand(tokens, cwd, workspaceRoot) ||
    isAutoAcceptPythonCommand(tokens, cwd, workspaceRoot) ||
    isAutoAcceptRCommand(tokens, cwd, workspaceRoot) ||
    isAutoAcceptJuliaCommand(tokens, cwd, workspaceRoot) ||
    isAutoAcceptStataCommand(tokens, cwd, workspaceRoot)
  );
}

function hasUnsafeAutoAcceptShellSyntax(command: string): boolean {
  if (/[\n\r`]/.test(command) || /\$\(|\$\{|\$[A-Za-z_]/.test(command)) {
    return true;
  }

  let quote: "\"" | "'" | undefined;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === ";" || char === "&" || char === "|" || char === "<" || char === ">") {
      return true;
    }
  }

  return Boolean(quote);
}

function isAutoAcceptNodeCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (isNamedExecutable(tokens[0], ["node"], cwd, workspaceRoot)) {
    return tokens[1] === "--test" &&
      areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(2), cwd, workspaceRoot);
  }

  if (isNamedExecutable(tokens[0], ["npx"], cwd, workspaceRoot)) {
    return tokens[1] === "tsc" &&
      areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(2), cwd, workspaceRoot);
  }

  return false;
}

function isAutoAcceptPythonCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (!isNamedExecutable(tokens[0], ["python", "python3"], cwd, workspaceRoot)) {
    return isAutoAcceptPythonToolCommand(tokens, cwd, workspaceRoot);
  }

  const moduleIndex = tokens.indexOf("-m");
  if (moduleIndex >= 0) {
    const moduleName = tokens[moduleIndex + 1]?.toLowerCase();
    const moduleArgs = tokens.slice(moduleIndex + 2);
    return isAutoAcceptPythonModuleCommand(
      moduleName,
      moduleArgs,
      cwd,
      workspaceRoot,
    );
  }

  const scriptIndex = findFirstScriptTokenIndex(tokens, 1, [".py"], ["-c"]);
  if (scriptIndex === undefined) {
    return false;
  }

  return (
    isWorkspaceFile(tokens[scriptIndex], cwd, workspaceRoot, [".py"]) &&
    areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(scriptIndex + 1), cwd, workspaceRoot)
  );
}

function isAutoAcceptPythonModuleCommand(
  moduleName: string | undefined,
  args: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (!moduleName) {
    return false;
  }

  const safeModules = new Set([
    "build",
    "compileall",
    "mypy",
    "py_compile",
    "pylint",
    "pytest",
    "pyright",
    "unittest",
  ]);
  if (safeModules.has(moduleName)) {
    return areAutoAcceptArgumentsWorkspaceSafe(args, cwd, workspaceRoot);
  }

  if (moduleName === "ruff") {
    return isAutoAcceptRuffCommand(args, cwd, workspaceRoot);
  }

  if (moduleName === "black") {
    return isAutoAcceptBlackCheckCommand(args, cwd, workspaceRoot);
  }

  if (moduleName === "isort") {
    return isAutoAcceptIsortCheckCommand(args, cwd, workspaceRoot);
  }

  return false;
}

function isAutoAcceptPythonToolCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  const executable = commandBasename(tokens[0]);
  const args = tokens.slice(1);

  if (["pytest", "py.test", "mypy", "pyright", "pylint"].includes(executable)) {
    return areAutoAcceptArgumentsWorkspaceSafe(args, cwd, workspaceRoot);
  }

  if (executable === "ruff") {
    return isAutoAcceptRuffCommand(args, cwd, workspaceRoot);
  }

  if (executable === "black") {
    return isAutoAcceptBlackCheckCommand(args, cwd, workspaceRoot);
  }

  if (executable === "isort") {
    return isAutoAcceptIsortCheckCommand(args, cwd, workspaceRoot);
  }

  return false;
}

function isAutoAcceptRuffCommand(
  args: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  const subcommand = args[0];
  if (subcommand === "check") {
    return areAutoAcceptArgumentsWorkspaceSafe(args.slice(1), cwd, workspaceRoot);
  }
  if (subcommand === "format" && args.includes("--check")) {
    return areAutoAcceptArgumentsWorkspaceSafe(args.slice(1), cwd, workspaceRoot);
  }
  return false;
}

function isAutoAcceptBlackCheckCommand(
  args: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  return args.includes("--check") &&
    areAutoAcceptArgumentsWorkspaceSafe(args, cwd, workspaceRoot);
}

function isAutoAcceptIsortCheckCommand(
  args: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  return (args.includes("--check") || args.includes("--check-only")) &&
    areAutoAcceptArgumentsWorkspaceSafe(args, cwd, workspaceRoot);
}

function isAutoAcceptRCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (isNamedExecutable(tokens[0], ["rscript"], cwd, workspaceRoot)) {
    const scriptIndex = findFirstScriptTokenIndex(tokens, 1, [".r"], ["-e", "--expr"]);
    return scriptIndex !== undefined &&
      isWorkspaceFile(tokens[scriptIndex], cwd, workspaceRoot, [".r"]) &&
      areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(scriptIndex + 1), cwd, workspaceRoot);
  }

  if (!isNamedExecutable(tokens[0], ["r"], cwd, workspaceRoot)) {
    return false;
  }

  if (tokens[1]?.toLowerCase() === "cmd") {
    return isAutoAcceptRCmdCommand(tokens, cwd, workspaceRoot);
  }

  const fileToken = findOptionValue(tokens, "-f", "--file");
  return fileToken !== undefined &&
    isWorkspaceFile(fileToken, cwd, workspaceRoot, [".r"]) &&
    areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(1), cwd, workspaceRoot);
}

function isAutoAcceptRCmdCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  const subcommand = tokens[2]?.toLowerCase();
  if (subcommand === "check" || subcommand === "build") {
    const targetIndex = findFirstNonOptionIndex(tokens, 3);
    const target = targetIndex === undefined ? "." : tokens[targetIndex];
    return isWorkspacePath(target, cwd, workspaceRoot) &&
      areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(3), cwd, workspaceRoot);
  }

  if (subcommand === "batch") {
    const scriptIndex = findFirstScriptTokenIndex(tokens, 3, [".r"], []);
    return scriptIndex !== undefined &&
      isWorkspaceFile(tokens[scriptIndex], cwd, workspaceRoot, [".r"]) &&
      areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(scriptIndex + 1), cwd, workspaceRoot);
  }

  return false;
}

function isAutoAcceptJuliaCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (!isNamedExecutable(tokens[0], ["julia"], cwd, workspaceRoot)) {
    return false;
  }

  const evalToken = findOptionValue(tokens, "-e", "--eval");
  if (evalToken) {
    return isSafeJuliaEval(evalToken) &&
      areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(1), cwd, workspaceRoot);
  }

  const scriptIndex = findFirstScriptTokenIndex(tokens, 1, [".jl"], ["-e", "--eval"]);
  return scriptIndex !== undefined &&
    isWorkspaceFile(tokens[scriptIndex], cwd, workspaceRoot, [".jl"]) &&
    areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(scriptIndex + 1), cwd, workspaceRoot);
}

function isSafeJuliaEval(expression: string): boolean {
  const normalized = expression.replace(/\s+/g, " ").trim();
  return [
    "using Pkg; Pkg.test()",
    "import Pkg; Pkg.test()",
    "using Pkg; Pkg.status()",
    "import Pkg; Pkg.status()",
  ].includes(normalized);
}

function isAutoAcceptStataCommand(
  tokens: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (
    !isNamedExecutable(
      tokens[0],
      ["stata", "stata-mp", "stata-se", "statamp", "statase", "xstata", "xstata-mp", "xstata-se"],
      cwd,
      workspaceRoot,
    )
  ) {
    return false;
  }

  const hasBatchFlag = tokens.some((token) => /^-b(?:atch)?$/i.test(token));
  const doIndex = tokens.findIndex((token) => token.toLowerCase() === "do");
  if (!hasBatchFlag || doIndex < 0) {
    return false;
  }

  const doFile = tokens[doIndex + 1];
  if (!doFile.toLowerCase().endsWith(".do") || path.isAbsolute(doFile)) {
    return false;
  }

  return isWorkspaceFile(doFile, cwd, workspaceRoot, [".do"]) &&
    areAutoAcceptArgumentsWorkspaceSafe(tokens.slice(doIndex + 2), cwd, workspaceRoot);
}

function isNamedExecutable(
  token: string | undefined,
  names: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (!token) {
    return false;
  }

  const basename = commandBasename(token);
  if (!names.includes(basename)) {
    return false;
  }

  if (token.includes("/") || path.isAbsolute(token)) {
    return isPathInside(workspaceRoot, path.resolve(cwd, token));
  }

  return true;
}

function commandBasename(token: string): string {
  return path.basename(token).toLowerCase();
}

function isWorkspaceFile(
  fileToken: string,
  cwd: string,
  workspaceRoot: string,
  extensions: string[],
): boolean {
  if (!hasAllowedExtension(fileToken, extensions)) {
    return false;
  }

  const filePath = path.resolve(cwd, fileToken);
  if (!isPathInside(workspaceRoot, filePath)) {
    return false;
  }

  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isWorkspacePath(token: string, cwd: string, workspaceRoot: string): boolean {
  if (!token || token.startsWith("~")) {
    return false;
  }

  return isPathInside(workspaceRoot, path.resolve(cwd, token));
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasAllowedExtension(fileToken: string, extensions: string[]): boolean {
  const lower = fileToken.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

function findFirstScriptTokenIndex(
  tokens: string[],
  startIndex: number,
  extensions: string[],
  disallowedOptions: string[],
): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (disallowedOptions.includes(lower)) {
      return undefined;
    }
    if (isOptionToken(token)) {
      index += optionConsumesValue(token) ? 1 : 0;
      continue;
    }
    if (hasAllowedExtension(token, extensions)) {
      return index;
    }
    return undefined;
  }
  return undefined;
}

function findFirstNonOptionIndex(tokens: string[], startIndex: number): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (isOptionToken(tokens[index])) {
      index += optionConsumesValue(tokens[index]) ? 1 : 0;
      continue;
    }
    return index;
  }
  return undefined;
}

function findOptionValue(
  tokens: string[],
  shortOption: string,
  longOption: string,
): string | undefined {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === shortOption || token === longOption) {
      return tokens[index + 1];
    }
    if (token.startsWith(`${longOption}=`)) {
      return token.slice(longOption.length + 1);
    }
  }
  return undefined;
}

function isOptionToken(token: string): boolean {
  return token.startsWith("-");
}

function optionConsumesValue(token: string): boolean {
  if (token.includes("=")) {
    return false;
  }
  return [
    "-f",
    "--file",
    "-o",
    "--output",
    "-p",
    "--project",
    "-t",
    "--threads",
    "-W",
    "-X",
  ].includes(token);
}

function areAutoAcceptArgumentsWorkspaceSafe(
  args: string[],
  cwd: string,
  workspaceRoot: string,
): boolean {
  return args.every((arg) => isAutoAcceptArgumentWorkspaceSafe(arg, cwd, workspaceRoot));
}

function isAutoAcceptArgumentWorkspaceSafe(
  arg: string,
  cwd: string,
  workspaceRoot: string,
): boolean {
  if (!arg || arg === ".") {
    return true;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || arg.startsWith("~")) {
    return false;
  }

  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
  if (!looksPathLike(value)) {
    return true;
  }

  return isWorkspacePath(value, cwd, workspaceRoot);
}

function looksPathLike(value: string): boolean {
  return (
    value === "." ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes("/") ||
    /\.(py|r|jl|do|qmd|ipynb|csv|tsv|parquet|dta|json|toml|ya?ml|txt|md)$/i.test(value)
  );
}

function splitSimpleCommandLine(text: string): string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;

  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return undefined;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
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
