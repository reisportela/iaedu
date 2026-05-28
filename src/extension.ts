import * as vscode from "vscode";
import { applyLocalAction, LocalAction, parseLocalActions } from "./actions";
import { getCodexSkillContext } from "./codexSkills";
import {
  configureConnection,
  ensureSettings,
  getSettings,
  IaeduSettings,
  importDotEnv,
  isConfigured,
  loadModelConfigFile,
  logout,
  saveConnectionSettings,
  saveModelConfigFile,
  selectModelProfile,
  setApiKey,
  setChannelId,
  setEndpoint,
  setThreadId,
  startNewThread,
} from "./config";
import {
  appendChatHistoryMessage,
  ensureChatHistoryThread,
  getChatHistorySummaries,
  getChatHistoryThread,
  stripLocalActionBlocks,
  touchChatHistoryThread,
} from "./chatHistory";
import {
  buildPrompt,
  getEditorContext,
  getWorkspaceOverview,
  getWorkspaceInstructions,
  IaeduMode,
  shouldIncludeWorkspaceOverview,
} from "./editorContext";
import { sendIaeduMessage } from "./iaeduClient";

let activeProvider: IAEduChatViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("IAEDU Agent activated");
  const output = vscode.window.createOutputChannel("IAEDU Agent");
  const chatProvider = new IAEduChatViewProvider(context, output);
  activeProvider = chatProvider;

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider("iaedu.chatView", chatProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.commands.registerCommand("iaedu.openChat", async () => {
      await chatProvider.reveal();
    }),
    vscode.commands.registerCommand("iaedu.askSelection", async () => {
      const question = await vscode.window.showInputBox({
        title: "Ask IAEDU about the selection",
        prompt: "The current selection will be sent as context.",
        value: "Analyse and explain the selection.",
        ignoreFocusOut: true,
      });
      if (!question) {
        return;
      }
      await chatProvider.submitPrompt(question, { contextMode: "selection" });
    }),
    vscode.commands.registerCommand("iaedu.askActiveFile", async () => {
      const question = await vscode.window.showInputBox({
        title: "Ask IAEDU about the active file",
        prompt: "The active file will be sent as context.",
        value: "Analyse this file and suggest improvements.",
        ignoreFocusOut: true,
      });
      if (!question) {
        return;
      }
      await chatProvider.submitPrompt(question, { contextMode: "activeFile" });
    }),
    vscode.commands.registerCommand("iaedu.setApiKey", () => setApiKey(context)),
    vscode.commands.registerCommand("iaedu.login", async () => {
      await configureConnection(context);
      chatProvider.refreshSettings();
    }),
    vscode.commands.registerCommand("iaedu.logout", async () => {
      await logout(context);
      chatProvider.refreshSettings();
    }),
    vscode.commands.registerCommand("iaedu.selectModelProfile", async () => {
      await selectModelProfile(context);
      chatProvider.refreshSettings();
    }),
    vscode.commands.registerCommand("iaedu.setEndpoint", () => setEndpoint(context)),
    vscode.commands.registerCommand("iaedu.setChannelId", () => setChannelId(context)),
    vscode.commands.registerCommand("iaedu.importDotEnv", () =>
      importDotEnv(context),
    ),
    vscode.commands.registerCommand("iaedu.loadModelConfigFile", async () => {
      await loadModelConfigFile(context);
      chatProvider.refreshSettings();
    }),
    vscode.commands.registerCommand("iaedu.saveModelConfigFile", async () => {
      await saveModelConfigFile(context);
      chatProvider.refreshSettings();
    }),
    vscode.commands.registerCommand("iaedu.clearThread", async () => {
      const threadId = await chatProvider.startNewConversation();
      if (threadId) {
        vscode.window.showInformationMessage("IAEDU started a new chat.");
      }
    }),
  );
}

export function deactivate() {
  activeProvider?.dispose();
  activeProvider = undefined;
}

type ContextMode = "selection" | "activeFile";

interface SubmitOptions {
  contextMode?: ContextMode;
  mode?: IaeduMode;
  autoAcceptActions?: boolean;
  includeCodexSkills?: boolean;
}

interface PendingPrompt {
  userPrompt: string;
  options: SubmitOptions;
}

class IAEduChatViewProvider implements vscode.WebviewViewProvider {
  private session: IAEduChatSession | undefined;
  private readonly pending: PendingPrompt[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "node_modules"),
      ],
    };

    this.session = new IAEduChatSession(
      this.context,
      this.output,
      webviewView.webview,
    );
    webviewView.onDidDispose(() => {
      this.session?.dispose();
      this.session = undefined;
    });

    const pending = this.pending.splice(0);
    for (const item of pending) {
      this.session.submitPrompt(item.userPrompt, item.options);
    }
  }

  async reveal() {
    await vscode.commands.executeCommand("workbench.view.extension.iaeduAgent");
    await vscode.commands.executeCommand("iaedu.chatView.focus");
  }

  async submitPrompt(userPrompt: string, options: SubmitOptions = {}) {
    await this.reveal();
    if (!this.session) {
      this.pending.push({ userPrompt, options });
      return;
    }

    await this.session.submitPrompt(userPrompt, options);
  }

  postStatus(text: string) {
    this.session?.postStatus(text);
  }

  refreshSettings() {
    this.session?.refreshSettings();
  }

  async startNewConversation(): Promise<string | undefined> {
    await this.reveal();
    if (this.session) {
      return this.session.startNewConversation();
    }

    const settings = await getSettings(this.context);
    const threadId = startNewThread(this.context, settings.modelProfileId);
    await ensureChatHistoryThread(this.context, settings.modelProfileId, threadId);
    return threadId;
  }

  dispose() {
    this.session?.dispose();
    this.session = undefined;
  }
}

class IAEduChatSession {
  private abortController: AbortController | undefined;
  private readonly promptQueue: PendingPrompt[] = [];
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly webview: vscode.Webview,
  ) {
    this.webview.html = this.getHtml();
    this.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message),
      undefined,
      context.subscriptions,
    );
  }

  dispose() {
    this.disposed = true;
    this.promptQueue.splice(0);
    this.abortController?.abort();
  }

  postStatus(text: string) {
    this.webview.postMessage({ type: "status", text });
  }

  async submitPrompt(userPrompt: string, options: SubmitOptions = {}) {
    const normalizedPrompt = userPrompt.trim();
    if (!normalizedPrompt || this.disposed) {
      return;
    }

    if (this.abortController) {
      this.queuePrompt(normalizedPrompt, options);
      return;
    }

    await this.runPrompt(normalizedPrompt, options);
  }

  private async runPrompt(userPrompt: string, options: SubmitOptions = {}) {
    const settings = await ensureSettings(this.context);
    if (!settings) {
      return;
    }

    if (this.abortController) {
      this.queuePrompt(userPrompt, options);
      return;
    }

    const mode = normalizeMode(options.mode);
    const autoAcceptActions = Boolean(options.autoAcceptActions && mode === "agent");
    const contextMode = options.contextMode;
    const editorContext = contextMode
      ? getEditorContext(contextMode, settings.maxContextChars)
      : undefined;
    const workspaceInstructions = await getWorkspaceInstructions(
      settings.maxContextChars,
    );
    const workspaceOverview = shouldIncludeWorkspaceOverview(userPrompt, mode)
      ? await getWorkspaceOverview(settings.maxContextChars)
      : undefined;
    const includeCodexSkills =
      options.includeCodexSkills ?? settings.codexSkills.enabled;
    const codexSkillContext = getCodexSkillContext(userPrompt, {
      ...settings.codexSkills,
      enabled: includeCodexSkills,
    });
    const userContext = {
      source: "vscode-extension",
      workspace: vscode.workspace.name,
      mode,
      autoAcceptActions,
      workspaceInstructions: workspaceInstructions?.userContext,
      workspaceOverview: workspaceOverview?.userContext,
      codexSkills: codexSkillContext?.userContext,
      ...editorContext?.userContext,
    };
    const prompt = buildPrompt(
      userPrompt,
      editorContext?.text,
      mode,
      workspaceInstructions?.text,
      workspaceOverview?.text,
      codexSkillContext?.text,
    );
    const assistantId = `assistant-${Date.now()}`;
    this.abortController = new AbortController();

    await ensureChatHistoryThread(
      this.context,
      settings.modelProfileId,
      settings.threadId,
    );
    await appendChatHistoryMessage(
      this.context,
      settings.modelProfileId,
      settings.threadId,
      {
        role: "user",
        text: userPrompt,
        mode,
        contextMode: editorContext?.userContext.contextMode as
          | "selection"
          | "activeFile"
          | undefined,
        codexSkills: Boolean(codexSkillContext),
      },
    );
    this.postConversationList(settings);

    this.webview.postMessage({
      type: "user",
      text: userPrompt,
      mode,
      contextMode: editorContext?.userContext.contextMode,
      codexSkills: Boolean(codexSkillContext),
    });
    this.webview.postMessage({ type: "assistantStart", id: assistantId });
    this.webview.postMessage({ type: "busy", busy: true });

    try {
      const responseText = await sendIaeduMessage(
        {
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
          channelId: settings.channelId,
          threadId: settings.threadId,
          message: prompt,
          userInfo: settings.userInfo,
          userContext: JSON.stringify(userContext),
          signal: this.abortController.signal,
        },
        (delta) => {
          this.webview.postMessage({
            type: "assistantDelta",
            id: assistantId,
            text: delta,
          });
        },
      );

      const actions = mode === "agent" ? parseLocalActions(responseText) : [];
      const visibleActions = await this.processAutoAcceptActions(
        actions,
        autoAcceptActions,
      );
      const visibleResponseText = stripLocalActionBlocks(responseText);
      if (visibleResponseText.trim()) {
        await appendChatHistoryMessage(
          this.context,
          settings.modelProfileId,
          settings.threadId,
          {
            role: "assistant",
            text: visibleResponseText,
          },
        );
        this.postConversationList(settings);
      }
      this.webview.postMessage({
        type: "assistantDone",
        id: assistantId,
        actions: visibleActions,
        mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.abortController?.signal.aborted) {
        this.webview.postMessage({ type: "status", text: "Request cancelled." });
      } else {
        this.output.appendLine(message);
        await appendChatHistoryMessage(
          this.context,
          settings.modelProfileId,
          settings.threadId,
          {
            role: "error",
            text: message,
          },
        );
        this.postConversationList(settings);
        this.webview.postMessage({ type: "error", text: message });
      }
    } finally {
      this.abortController = undefined;
      this.webview.postMessage({ type: "busy", busy: false });
      await this.runNextQueuedPrompt();
    }
  }

  private queuePrompt(userPrompt: string, options: SubmitOptions) {
    const maxQueuedPrompts = 10;
    if (this.promptQueue.length >= maxQueuedPrompts) {
      this.webview.postMessage({
        type: "status",
        text: `Queue full: ${maxQueuedPrompts} message(s) already waiting.`,
      });
      return;
    }

    this.promptQueue.push({ userPrompt, options });
    this.webview.postMessage({
      type: "status",
      text: `Queued message ${this.promptQueue.length}. It will run after the current response.`,
    });
  }

  private async runNextQueuedPrompt() {
    const next = this.promptQueue.shift();
    if (!next || this.disposed) {
      return;
    }

    this.webview.postMessage({
      type: "status",
      text: `Running queued message. ${this.promptQueue.length} still waiting.`,
    });
    await this.submitPrompt(next.userPrompt, next.options);
  }

  private async handleWebviewMessage(message: WebviewMessage) {
    if (message.type === "ready") {
      await this.refreshSettings(false);
      return;
    }

    if (message.type === "send") {
      await this.submitPrompt(message.text, {
        contextMode: message.includeActiveFile ? "activeFile" : undefined,
        mode: normalizeMode(message.mode),
        autoAcceptActions: message.autoAcceptActions,
        includeCodexSkills: message.includeCodexSkills,
      });
      return;
    }

    if (message.type === "stop") {
      this.abortController?.abort();
      return;
    }

    if (message.type === "setApiKey") {
      this.webview.postMessage({ type: "showConfig", focusApiKey: true });
      return;
    }

    if (message.type === "login") {
      await this.refreshSettings();
      this.webview.postMessage({ type: "showConfig" });
      return;
    }

    if (message.type === "saveSettings") {
      const saved = await saveConnectionSettings(this.context, {
        profileId: message.profileId,
        profileName: message.profileName,
        endpoint: message.endpoint,
        apiKey: message.apiKey,
        channelId: message.channelId,
      });
      await this.refreshSettings();
      if (saved) {
        this.webview.postMessage({ type: "hideConfig" });
      }
      return;
    }

    if (message.type === "selectModelProfile") {
      await selectModelProfile(this.context, message.profileId, { silent: true });
      await this.refreshSettings();
      return;
    }

    if (message.type === "logout") {
      await logout(this.context);
      await this.refreshSettings();
      return;
    }

    if (message.type === "importDotEnv") {
      await importDotEnv(this.context);
      await this.refreshSettings();
      return;
    }

    if (message.type === "loadModelConfigFile") {
      await loadModelConfigFile(this.context);
      await this.refreshSettings();
      return;
    }

    if (message.type === "saveModelConfigFile") {
      await saveModelConfigFile(this.context);
      await this.refreshSettings();
      return;
    }

    if (message.type === "newThread") {
      await this.startNewConversation();
      return;
    }

    if (message.type === "selectConversation") {
      await this.selectConversation(message.threadId);
      return;
    }

    if (message.type === "saveConversation") {
      await this.saveConversation();
      return;
    }

    if (message.type === "copyText") {
      await vscode.env.clipboard.writeText(message.text);
      this.webview.postMessage({ type: "status", text: "Response copied." });
      return;
    }

    if (message.type === "applyAction") {
      const result = await applyLocalAction(message.action, this.output);
      this.webview.postMessage({ type: "status", text: result.message });
    }
  }

  async startNewConversation(): Promise<string | undefined> {
    if (this.abortController) {
      vscode.window.showWarningMessage("Stop the current IAEDU request before starting a new chat.");
      return undefined;
    }

    const settings = await getSettings(this.context);
    const threadId = startNewThread(this.context, settings.modelProfileId);
    await ensureChatHistoryThread(
      this.context,
      settings.modelProfileId,
      threadId,
    );
    this.webview.postMessage({
      type: "loadConversation",
      threadId,
      messages: [],
    });
    await this.refreshSettings();
    this.webview.postMessage({
      type: "status",
      text: `New chat: ${threadId}`,
    });
    return threadId;
  }

  private async selectConversation(threadId: string) {
    if (this.abortController) {
      vscode.window.showWarningMessage("Stop the current IAEDU request before switching chats.");
      return;
    }

    const selectedThreadId = threadId.trim();
    if (!selectedThreadId) {
      return;
    }

    const settings = await getSettings(this.context);
    const thread = getChatHistoryThread(
      this.context,
      settings.modelProfileId,
      selectedThreadId,
    );
    if (!thread) {
      this.webview.postMessage({
        type: "status",
        text: "Saved chat not found.",
      });
      await this.refreshSettings();
      return;
    }

    setThreadId(this.context, selectedThreadId, settings.modelProfileId);
    await this.refreshSettings();
    this.webview.postMessage({
      type: "status",
      text: `Loaded chat: ${thread.title}`,
    });
  }

  private async saveConversation() {
    const settings = await getSettings(this.context);
    const thread = await touchChatHistoryThread(
      this.context,
      settings.modelProfileId,
      settings.threadId,
    );
    this.postConversationList(settings);
    this.webview.postMessage({
      type: "status",
      text: `Saved chat: ${thread.title}`,
    });
  }

  private async postConversation(settings: IaeduSettings) {
    const thread = await ensureChatHistoryThread(
      this.context,
      settings.modelProfileId,
      settings.threadId,
    );
    this.webview.postMessage({
      type: "loadConversation",
      threadId: settings.threadId,
      messages: thread.messages,
    });
    this.postConversationList(settings);
  }

  private postConversationList(settings: IaeduSettings) {
    this.webview.postMessage({
      type: "conversationList",
      threadId: settings.threadId,
      conversations: getChatHistorySummaries(
        this.context,
        settings.modelProfileId,
      ),
    });
  }

  private async processAutoAcceptActions(
    actions: LocalAction[],
    autoAcceptActions: boolean,
  ): Promise<LocalAction[]> {
    if (!autoAcceptActions || actions.length === 0) {
      return actions;
    }

    const maxAutoActions = 10;
    if (actions.length > maxAutoActions) {
      this.webview.postMessage({
        type: "status",
        text: `Auto-accept blocked: ${actions.length} actions is too many to apply without review.`,
      });
      return actions;
    }

    const pending: LocalAction[] = [];
    let applied = 0;
    for (const action of actions) {
      const result = await applyLocalAction(action, this.output, {
        autoAccept: true,
      });
      if (result.status === "applied") {
        applied += 1;
      } else {
        pending.push(action);
      }
    }

    const pendingText =
      pending.length > 0 ? `; ${pending.length} left for review` : "";
    this.webview.postMessage({
      type: "status",
      text: `Auto-accept applied ${applied} action(s)${pendingText}.`,
    });
    return pending;
  }

  private getHtml(): string {
    const nonce = getNonce();
    const media = (...segments: string[]) =>
      this.webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, ...segments),
      );

    const stylesUri = media("media", "styles.css");
    const scriptUri = media("media", "main.js");
    const markdownItUri = media(
      "node_modules",
      "markdown-it",
      "dist",
      "markdown-it.min.js",
    );
    const katexCssUri = media("node_modules", "katex", "dist", "katex.min.css");
    const katexJsUri = media("node_modules", "katex", "dist", "katex.min.js");
    const katexAutoRenderUri = media(
      "node_modules",
      "katex",
      "dist",
      "contrib",
      "auto-render.min.js",
    );

    return `<!DOCTYPE html>
	<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.webview.cspSource} https: data:; font-src ${this.webview.cspSource}; style-src ${this.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link nonce="${nonce}" rel="stylesheet" href="${katexCssUri}">
  <link nonce="${nonce}" rel="stylesheet" href="${stylesUri}">
  <title>IAEDU Agent</title>
</head>
<body>
	  <main class="app">
	    <section id="configPanel" class="config-panel" hidden>
	      <form id="configForm" class="config-form">
		        <div class="config-title">IAEDU model settings</div>
	        <div class="config-grid">
	          <label class="config-field">
	            <span>Saved model</span>
	            <select id="configProfileSelect"></select>
	          </label>
	          <label class="config-field">
	            <span>Model name</span>
	            <input id="configProfileName" type="text" autocomplete="off" placeholder="e.g. GPT-4.1 agent">
	          </label>
	          <label class="config-field">
	            <span>Endpoint</span>
	            <input id="configEndpoint" type="url" placeholder="https://api.iaedu.pt/agent-chat/...">
	          </label>
	          <label class="config-field">
	            <span>API key</span>
		            <input id="configApiKey" type="password" autocomplete="off" placeholder="keep saved key">
	          </label>
	          <label class="config-field">
	            <span>Channel ID</span>
	            <input id="configChannelId" type="text" autocomplete="off">
	          </label>
		        </div>
		        <div class="config-actions">
		          <button id="configLoadFile" type="button">load file</button>
		          <button id="configSaveFile" type="button">save file</button>
		          <button id="configNewProfile" type="button">new model</button>
		          <button id="configCancel" type="button">cancel</button>
		          <button id="configSave" type="submit">save</button>
		        </div>
	      </form>
	    </section>
	    <section id="messages" class="messages" aria-live="polite"></section>
    <form id="composer" class="composer">
	      <textarea id="prompt" rows="4" placeholder="Ask the IAEDU agent..."></textarea>
	      <div class="toolbar">
	        <div class="toolbar-group toolbar-context" aria-label="Context and mode">
	          <label class="toggle">
	            <input id="includeActiveFile" type="checkbox">
	            <span>active file</span>
	          </label>
	          <div class="mode-switch" role="radiogroup" aria-label="IAEDU mode">
	            <label>
	              <input type="radio" name="iaeduMode" value="ask" checked>
	              <span>ask</span>
	            </label>
	            <label>
	              <input type="radio" name="iaeduMode" value="plan">
	              <span>plan</span>
	            </label>
	            <label>
	              <input type="radio" name="iaeduMode" value="agent">
	              <span>agent</span>
	            </label>
	          </div>
	          <label id="autoAcceptWrap" class="toggle auto-accept" title="Automatically applies only actions considered safe inside the workspace.">
	            <input id="autoAcceptActions" type="checkbox">
	            <span>auto-accept</span>
	          </label>
	          <label class="toggle" title="Include matching local Codex SKILL.md instructions in this request.">
	            <input id="includeCodexSkills" type="checkbox">
	            <span>Use skills from Codex</span>
	          </label>
	        </div>
	        <div class="toolbar-group toolbar-model" aria-label="Model">
	          <select id="modelSelect" title="IAEDU model"></select>
	        </div>
	        <div class="toolbar-group toolbar-config" aria-label="Settings">
	          <button id="login" type="button">config</button>
	        </div>
	        <div class="toolbar-group toolbar-session" aria-label="Session">
	          <select id="conversationSelect" title="Saved chats"></select>
	          <button id="saveConversation" type="button">save chat</button>
	          <button id="newThread" type="button">new chat</button>
	        </div>
	        <div class="toolbar-group toolbar-run" aria-label="Run">
	          <button id="stop" type="button" disabled>stop</button>
	          <button id="send" type="submit">send</button>
	        </div>
	      </div>
      <div id="status" class="status"></div>
    </form>
  </main>
  <script nonce="${nonce}" src="${markdownItUri}"></script>
  <script nonce="${nonce}" src="${katexJsUri}"></script>
  <script nonce="${nonce}" src="${katexAutoRenderUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  async refreshSettings(promptIfMissing = false) {
    const current = await getSettings(this.context);
    let settings = current;

    if (promptIfMissing && !isConfigured(current)) {
      const configured = await configureConnection(this.context);
      if (configured) {
        settings = configured;
      }
    }

    this.webview.postMessage({
      type: "settings",
      configured: isConfigured(settings),
      endpoint: settings.endpoint,
      channelId: settings.channelId,
      hasApiKey: Boolean(settings.apiKey),
      modelProfileId: settings.modelProfileId,
      modelName: settings.modelName,
      modelProfiles: settings.modelProfiles,
      defaultIncludeActiveFile: settings.defaultIncludeActiveFile,
      defaultMode: settings.defaultMode,
      codexSkillsEnabled: settings.codexSkills.enabled,
      extensionVersion: getExtensionVersion(this.context),
      threadId: settings.threadId,
    });
    await this.postConversation(settings);
  }
}

type WebviewMessage =
  | { type: "ready" }
  | {
      type: "send";
      text: string;
      includeActiveFile: boolean;
      mode: string;
      autoAcceptActions: boolean;
      includeCodexSkills?: boolean;
    }
  | { type: "stop" }
  | { type: "setApiKey" }
  | { type: "login" }
  | {
      type: "saveSettings";
      profileId?: string;
      profileName: string;
      endpoint: string;
      apiKey: string;
      channelId: string;
    }
  | { type: "selectModelProfile"; profileId: string }
  | { type: "logout" }
  | { type: "importDotEnv" }
  | { type: "loadModelConfigFile" }
  | { type: "saveModelConfigFile" }
  | { type: "newThread" }
  | { type: "selectConversation"; threadId: string }
  | { type: "saveConversation" }
  | { type: "copyText"; text: string }
  | { type: "applyAction"; action: LocalAction };

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function normalizeMode(value: unknown): IaeduMode {
  if (value === "plan" || value === "agent") {
    return value;
  }
  return "ask";
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
  const packageJson = context.extension.packageJSON as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "";
}
