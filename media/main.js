(function () {
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById("messages");
  const composer = document.getElementById("composer");
  const prompt = document.getElementById("prompt");
  const includeActiveFile = document.getElementById("includeActiveFile");
  const modeInputs = Array.from(document.querySelectorAll("input[name='iaeduMode']"));
  const autoAcceptWrap = document.getElementById("autoAcceptWrap");
  const autoAcceptActions = document.getElementById("autoAcceptActions");
  const sendButton = document.getElementById("send");
  const stopButton = document.getElementById("stop");
  const status = document.getElementById("status");
  const modelSelect = document.getElementById("modelSelect");
  const loginButton = document.getElementById("login");
  const configPanel = document.getElementById("configPanel");
  const configForm = document.getElementById("configForm");
  const configProfileSelect = document.getElementById("configProfileSelect");
  const configProfileName = document.getElementById("configProfileName");
  const configEndpoint = document.getElementById("configEndpoint");
  const configChannelId = document.getElementById("configChannelId");
  const configApiKey = document.getElementById("configApiKey");
  const configNewProfile = document.getElementById("configNewProfile");
  const configCancel = document.getElementById("configCancel");
  const newProfileValue = "__new__";

  const md =
    typeof window.markdownit === "function"
      ? window.markdownit({
          breaks: true,
          html: false,
          linkify: true,
          typographer: false,
        })
      : null;
  const mathDelimiters = [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false },
  ];
  const mathTokenPattern = /@@IAEDU_MATH_(\d+)@@/g;
  const assistantMessages = new Map();
  let busy = false;
  let lastSettings = undefined;

  on(composer, "submit", (event) => {
    event.preventDefault();
    if (!prompt) {
      return;
    }
    const text = prompt.value.trim();
    if (!text || busy) {
      return;
    }
    prompt.value = "";
    vscode.postMessage({
      type: "send",
      text,
      includeActiveFile: Boolean(includeActiveFile && includeActiveFile.checked),
      mode: getSelectedMode(),
      autoAcceptActions: shouldAutoAccept(),
    });
  });

  on(loginButton, "click", () => {
    showConfigPanel();
  });

  on(modelSelect, "change", () => {
    if (!modelSelect || !modelSelect.value || busy) {
      return;
    }
    if (lastSettings && modelSelect.value === lastSettings.modelProfileId) {
      return;
    }
    vscode.postMessage({
      type: "selectModelProfile",
      profileId: modelSelect.value,
    });
  });

  on(configProfileSelect, "change", () => {
    if (!configProfileSelect) {
      return;
    }
    if (configProfileSelect.value === newProfileValue) {
      setConfigProfileNew();
      return;
    }
    fillConfigFields(getProfile(configProfileSelect.value));
  });

  on(configNewProfile, "click", () => {
    setConfigProfileNew();
  });

  on(configCancel, "click", () => {
    hideConfigPanel();
  });

  on(configForm, "submit", (event) => {
    event.preventDefault();
    const selectedProfileId =
      configProfileSelect && configProfileSelect.value !== newProfileValue
        ? configProfileSelect.value
        : "";
    const existingProfile = selectedProfileId
      ? getProfile(selectedProfileId)
      : undefined;
    const profileName = configProfileName ? configProfileName.value.trim() : "";
    const endpoint = configEndpoint ? configEndpoint.value.trim() : "";
    const apiKey = configApiKey ? configApiKey.value.trim() : "";
    const channelId = configChannelId ? configChannelId.value.trim() : "";

    if (!profileName) {
      setStatus("Enter a model name.");
      if (configProfileName) {
        configProfileName.focus();
      }
      return;
    }

    if (!endpoint) {
      setStatus("Enter the endpoint.");
      if (configEndpoint) {
        configEndpoint.focus();
      }
      return;
    }

    if (!apiKey && !(existingProfile && existingProfile.hasApiKey)) {
      setStatus("Enter the API key.");
      if (configApiKey) {
        configApiKey.focus();
      }
      return;
    }

    if (!channelId) {
      setStatus("Enter the Channel ID.");
      if (configChannelId) {
        configChannelId.focus();
      }
      return;
    }

    vscode.postMessage({
      type: "saveSettings",
      profileId: selectedProfileId,
      profileName,
      endpoint,
      apiKey,
      channelId,
    });
  });

  on(document.getElementById("newThread"), "click", () => {
    vscode.postMessage({ type: "newThread" });
  });

  on(stopButton, "click", () => {
    vscode.postMessage({ type: "stop" });
  });

  modeInputs.forEach((input) => {
    on(input, "change", updateAutoAcceptState);
  });

  on(prompt, "keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      composer.requestSubmit();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "settings") {
      lastSettings = message;
      renderModelSelect(message);
      if (includeActiveFile) {
        includeActiveFile.checked = Boolean(message.defaultIncludeActiveFile);
      }
      setSelectedMode(message.defaultMode || "ask");
      updateAutoAcceptState();
      if (!isConfigPanelOpen()) {
        fillConfigForm(message);
      }
      setConfigured(Boolean(message.configured), message);
    } else if (message.type === "user") {
      addMessage("user", message.text, {
        mode: message.mode,
        contextMode: message.contextMode,
      });
    } else if (message.type === "assistantStart") {
      createAssistantMessage(message.id);
    } else if (message.type === "assistantDelta") {
      appendAssistantDelta(message.id, message.text);
    } else if (message.type === "assistantDone") {
      finishAssistantMessage(message.id, message.actions || []);
    } else if (message.type === "error") {
      addMessage("error", message.text);
    } else if (message.type === "busy") {
      setBusy(Boolean(message.busy));
    } else if (message.type === "status") {
      setStatus(message.text);
    } else if (message.type === "showConfig") {
      showConfigPanel({ focusApiKey: Boolean(message.focusApiKey) });
    } else if (message.type === "hideConfig") {
      hideConfigPanel();
    }
  });

  function addMessage(role, text, meta = {}) {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${role}`;
    const badges = renderBadges(meta);
    if (badges) {
      wrapper.appendChild(badges);
    }
    const body = document.createElement("div");
    body.className = "message-body";
    wrapper.appendChild(body);
    messages.appendChild(wrapper);
    render(body, text);
    scrollBottom();
  }

  function createAssistantMessage(id) {
    const wrapper = document.createElement("article");
    wrapper.className = "message assistant";
    const tools = document.createElement("div");
    tools.className = "message-tools";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-message";
    copyButton.textContent = "copy";
    copyButton.title = "Copy response";
    copyButton.disabled = true;
    tools.appendChild(copyButton);
    wrapper.appendChild(tools);
    const body = document.createElement("div");
    body.className = "message-body";
    wrapper.appendChild(body);
    messages.appendChild(wrapper);
    const item = { text: "", body, wrapper, copyButton };
    copyButton.addEventListener("click", () => {
      copyAssistantText(stripLocalActionBlocks(item.text), copyButton);
    });
    assistantMessages.set(id, item);
    scrollBottom();
  }

  function appendAssistantDelta(id, delta) {
    const item = assistantMessages.get(id);
    if (!item) {
      return;
    }
    item.text += delta;
    renderAssistantItem(item);
    scrollBottom();
  }

  function finishAssistantMessage(id, actions) {
    const item = assistantMessages.get(id);
    if (!item) {
      return;
    }
    renderAssistantItem(item);
    if (actions.length > 0) {
      item.wrapper.appendChild(renderActions(actions));
    }
    assistantMessages.delete(id);
    scrollBottom();
  }

  function copyAssistantText(text, button) {
    const value = text || "";
    if (!value.trim()) {
      return;
    }
    vscode.postMessage({ type: "copyText", text: value });
    if (button) {
      button.textContent = "copied";
      window.setTimeout(() => {
        button.textContent = "copy";
      }, 1200);
    }
  }

  function renderActions(actions) {
    const container = document.createElement("div");
    container.className = "actions";
    const title = document.createElement("div");
    title.className = "actions-title";
    title.textContent = "Proposed local actions";
    container.appendChild(title);

    actions.forEach((action, index) => {
      const row = document.createElement("div");
      row.className = "action-row";
      const label = document.createElement("span");
      label.textContent = describeAction(action);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Apply";
      button.addEventListener("click", () => {
        button.disabled = true;
        button.textContent = "Applying";
        vscode.postMessage({ type: "applyAction", action });
      });
      row.append(label, button);
      container.appendChild(row);
    });

    return container;
  }

  function describeAction(action) {
    if (action.title) {
      return action.title;
    }
    if (action.type === "writeFile") {
      return `file: ${action.path}`;
    }
    if (action.type === "appendFile") {
      return `append: ${action.path}`;
    }
    if (action.type === "replaceSelection") {
      return "replace selection";
    }
    if (action.type === "runCommand") {
      return commandSummary(action.command);
    }
    return "local action";
  }

  function commandSummary(command) {
    const firstToken = String(command || "").trim().split(/\s+/)[0];
    return firstToken ? `run command: ${firstToken}` : "run command";
  }

  function renderAssistantItem(item) {
    const visibleText = stripLocalActionBlocks(item.text);
    item.copyButton.disabled = visibleText.trim().length === 0;
    render(item.body, visibleText);
  }

  function stripLocalActionBlocks(text) {
    const source = text || "";
    const startPattern = /```(?:iaedu-action|iaedu-actions)\b[^\n]*\n?/gi;
    let result = "";
    let cursor = 0;
    let match;
    while ((match = startPattern.exec(source)) !== null) {
      result += source.slice(cursor, match.index);
      const endIndex = source.indexOf("```", startPattern.lastIndex);
      if (endIndex < 0) {
        cursor = source.length;
        break;
      }
      cursor = endIndex + 3;
      startPattern.lastIndex = cursor;
    }
    result += source.slice(cursor);
    return result.replace(/\n{3,}/g, "\n\n").trim();
  }

  function render(element, text) {
    const protectedMath = extractMathSegments(text || "");
    if (md) {
      element.innerHTML = md.render(protectedMath.text);
    } else {
      element.textContent = protectedMath.text;
    }
    insertMathSegments(element, protectedMath.segments);
    renderMath(element);
  }

  function extractMathSegments(source) {
    const codeSegments = [];
    const mathSegments = [];
    let text = source.replace(/```[\s\S]*?```/g, (match) => {
      const token = `@@IAEDU_CODE_${codeSegments.length}@@`;
      codeSegments.push(match);
      return token;
    });

    text = text.replace(/`[^`\n]+`/g, (match) => {
      const token = `@@IAEDU_CODE_${codeSegments.length}@@`;
      codeSegments.push(match);
      return token;
    });

    text = replaceMathPattern(text, /\$\$([\s\S]+?)\$\$/g, true, mathSegments);
    text = replaceMathPattern(text, /\\\[([\s\S]+?)\\\]/g, true, mathSegments);
    text = replaceMathPattern(text, /\\\(([\s\S]+?)\\\)/g, false, mathSegments);
    text = text.replace(/(^|[^\\$])\$([^\n$]+?)\$(?!\$)/g, (match, prefix, content) => {
      const token = createMathToken(content, false, mathSegments, `$${content}$`);
      return `${prefix}${token}`;
    });

    text = text.replace(/@@IAEDU_CODE_(\d+)@@/g, (match, index) => {
      return codeSegments[Number(index)] || match;
    });

    return { text, segments: mathSegments };
  }

  function replaceMathPattern(text, pattern, display, mathSegments) {
    return text.replace(pattern, (match, content) => {
      return createMathToken(content, display, mathSegments, match);
    });
  }

  function createMathToken(content, display, mathSegments, original) {
    const trimmed = content.trim();
    if (!trimmed) {
      return original;
    }

    const token = `@@IAEDU_MATH_${mathSegments.length}@@`;
    mathSegments.push({ content: trimmed, display, original });
    return token;
  }

  function insertMathSegments(element, segments) {
    if (segments.length === 0) {
      return;
    }

    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    nodes.forEach((node) => {
      const value = node.nodeValue || "";
      mathTokenPattern.lastIndex = 0;
      if (!mathTokenPattern.test(value)) {
        mathTokenPattern.lastIndex = 0;
        return;
      }

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      mathTokenPattern.lastIndex = 0;
      let match;
      while ((match = mathTokenPattern.exec(value)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(value.slice(lastIndex, match.index)),
          );
        }

        const segment = segments[Number(match[1])];
        fragment.appendChild(renderMathSegment(segment));
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
      }

      node.parentNode.replaceChild(fragment, node);
      mathTokenPattern.lastIndex = 0;
    });
  }

  function renderMathSegment(segment) {
    const node = document.createElement("span");
    if (!segment) {
      return node;
    }

    node.className = segment.display
      ? "iaedu-math iaedu-math-display"
      : "iaedu-math iaedu-math-inline";

    if (window.katex && typeof window.katex.render === "function") {
      try {
        window.katex.render(segment.content, node, {
          displayMode: segment.display,
          throwOnError: false,
          strict: "ignore",
          trust: false,
        });
        return node;
      } catch {
        // Fall through to the original text if KaTeX cannot parse the segment.
      }
    }

    node.textContent = segment.original;
    return node;
  }

  function renderMath(element) {
    if (typeof window.renderMathInElement !== "function") {
      return;
    }

    window.renderMathInElement(element, {
      throwOnError: false,
      strict: "ignore",
      trust: false,
      processEscapes: true,
      processEnvironments: true,
      ignoredTags: [
        "script",
        "noscript",
        "style",
        "textarea",
        "pre",
        "code",
        "option",
      ],
      delimiters: mathDelimiters,
    });
  }

  function setBusy(value) {
    busy = value;
    if (sendButton) {
      sendButton.disabled = value || sendButton.dataset.configured !== "true";
    }
    if (stopButton) {
      stopButton.disabled = !value;
    }
    if (prompt) {
      prompt.disabled = value;
    }
    if (modelSelect) {
      modelSelect.disabled = value || getProfiles().length === 0;
    }
  }

  function setConfigured(configured, settings) {
    if (sendButton) {
      sendButton.dataset.configured = configured ? "true" : "false";
      sendButton.disabled = busy || !configured;
    }
    if (prompt) {
      prompt.disabled = busy;
    }
    if (loginButton) {
      loginButton.textContent = configured ? "config" : "sign in";
    }
    if (configured) {
      const endpoint = settings.endpoint || "";
      const shortEndpoint =
        endpoint.length > 44 ? `${endpoint.slice(0, 41)}...` : endpoint;
      setStatus(
        `connected | model: ${settings.modelName || "-"} | channel: ${settings.channelId || "-"} | ${shortEndpoint} | thread: ${settings.threadId}`,
      );
    } else {
      setStatus("not signed in: set a model profile, endpoint, Channel ID and API key");
    }
  }

  function setStatus(text) {
    if (status) {
      status.textContent = text || "";
    }
  }

  function getSelectedMode() {
    const selected = modeInputs.find((input) => input.checked);
    if (!selected) {
      return "ask";
    }
    return ["ask", "plan", "agent"].includes(selected.value)
      ? selected.value
      : "ask";
  }

  function setSelectedMode(mode) {
    const normalized = ["ask", "plan", "agent"].includes(mode) ? mode : "ask";
    modeInputs.forEach((input) => {
      input.checked = input.value === normalized;
    });
    updateAutoAcceptState();
  }

  function shouldAutoAccept() {
    return Boolean(
      autoAcceptActions &&
        autoAcceptActions.checked &&
        getSelectedMode() === "agent",
    );
  }

  function updateAutoAcceptState() {
    const agentSelected = getSelectedMode() === "agent";
    if (autoAcceptWrap) {
      autoAcceptWrap.dataset.enabled = agentSelected ? "true" : "false";
    }
    if (autoAcceptActions) {
      autoAcceptActions.disabled = !agentSelected;
      if (!agentSelected) {
        autoAcceptActions.checked = false;
      }
    }
  }

  function renderBadges(meta) {
    const values = [];
    if (meta.mode) {
      values.push(meta.mode);
    }
    if (meta.contextMode === "selection") {
      values.push("selection");
    } else if (meta.contextMode === "activeFile") {
      values.push("file");
    }
    if (values.length === 0) {
      return undefined;
    }

    const container = document.createElement("div");
    container.className = "message-meta";
    values.forEach((value) => {
      const badge = document.createElement("span");
      badge.textContent = value;
      container.appendChild(badge);
    });
    return container;
  }

  function showConfigPanel(options = {}) {
    fillConfigForm(lastSettings);
    if (configPanel) {
      configPanel.hidden = false;
    }
    if (options.focusApiKey && configApiKey) {
      configApiKey.focus();
    } else if (configProfileName && configProfileSelect && configProfileSelect.value === newProfileValue) {
      configProfileName.focus();
    } else if (configEndpoint) {
      configEndpoint.focus();
    }
  }

  function hideConfigPanel() {
    if (configPanel) {
      configPanel.hidden = true;
    }
    if (configApiKey) {
      configApiKey.value = "";
    }
    if (prompt) {
      prompt.focus();
    }
  }

  function fillConfigForm(settings) {
    if (!settings) {
      return;
    }
    renderConfigProfileOptions(settings);
    const profiles = getProfiles(settings);
    const activeProfile =
      getProfile(settings.modelProfileId) ||
      (profiles.length > 0
        ? {
            id: settings.modelProfileId || "",
            name: settings.modelName || "",
            endpoint: settings.endpoint || "",
            channelId: settings.channelId || "",
            hasApiKey: Boolean(settings.hasApiKey),
          }
        : undefined);
    fillConfigFields(activeProfile);
  }

  function fillConfigFields(profile) {
    if (configProfileName) {
      configProfileName.value = profile ? profile.name || "" : "";
    }
    if (configEndpoint) {
      configEndpoint.value = profile ? profile.endpoint || "" : "";
    }
    if (configChannelId) {
      configChannelId.value = profile ? profile.channelId || "" : "";
    }
    if (configApiKey) {
      configApiKey.value = "";
      configApiKey.placeholder = profile && profile.hasApiKey
        ? "keep saved key"
        : "API key";
    }
  }

  function renderModelSelect(settings) {
    if (!modelSelect) {
      return;
    }
    replaceOptions(modelSelect, []);
    const profiles = getProfiles(settings);
    if (profiles.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No model";
      modelSelect.appendChild(option);
      modelSelect.disabled = true;
      return;
    }

    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name || profile.id;
      modelSelect.appendChild(option);
    });
    modelSelect.value = settings.modelProfileId || profiles[0].id;
    modelSelect.disabled = busy;
  }

  function renderConfigProfileOptions(settings) {
    if (!configProfileSelect) {
      return;
    }
    replaceOptions(configProfileSelect, []);
    const profiles = getProfiles(settings);
    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name || profile.id;
      configProfileSelect.appendChild(option);
    });

    const newOption = document.createElement("option");
    newOption.value = newProfileValue;
    newOption.textContent = "Add new model";
    configProfileSelect.appendChild(newOption);
    configProfileSelect.value = profiles.some(
      (profile) => profile.id === settings.modelProfileId,
    )
      ? settings.modelProfileId
      : newProfileValue;
  }

  function setConfigProfileNew() {
    if (configProfileSelect) {
      configProfileSelect.value = newProfileValue;
    }
    fillConfigFields(undefined);
    if (configProfileName) {
      configProfileName.focus();
    }
  }

  function getProfile(profileId) {
    return getProfiles().find((profile) => profile.id === profileId);
  }

  function getProfiles(settings = lastSettings) {
    return settings && Array.isArray(settings.modelProfiles)
      ? settings.modelProfiles
      : [];
  }

  function replaceOptions(select, options) {
    select.replaceChildren(...options);
  }

  function isConfigPanelOpen() {
    return Boolean(configPanel && !configPanel.hidden);
  }

  function scrollBottom() {
    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function on(element, eventName, listener) {
    if (element) {
      element.addEventListener(eventName, listener);
    }
  }

  vscode.postMessage({ type: "ready" });
})();
