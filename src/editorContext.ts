import * as path from "node:path";
import * as vscode from "vscode";

export interface EditorContextResult {
  text: string;
  userContext: Record<string, unknown>;
}

export type IaeduMode = "ask" | "plan" | "agent";

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

export function buildPrompt(
  userPrompt: string,
  contextText?: string,
  mode: IaeduMode = "ask",
): string {
  const parts = [MODE_INSTRUCTIONS[mode]];
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
    "You may help analyse, edit files, and propose commands, but local execution is always handled by the extension with user confirmation.",
    "When you want to propose a local action, include a fenced block whose language is exactly iaedu-action.",
    "Supported format:",
    "```iaedu-action",
    "{\"actions\":[{\"type\":\"writeFile\",\"path\":\"relative/path.txt\",\"content\":\"...\"},{\"type\":\"replaceSelection\",\"content\":\"...\"},{\"type\":\"runCommand\",\"command\":\"npm test\"}]}",
    "```",
    "Use paths relative to the workspace. Do not propose destructive commands. Outside that block, briefly explain why the action is proposed.",
  ].join("\n"),
};
