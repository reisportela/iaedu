import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const webviewScript = readFileSync(
  new URL("../media/main.js", import.meta.url),
  "utf8",
);
const extensionSource = readFileSync(
  new URL("../src/extension.ts", import.meta.url),
  "utf8",
);
const actionsSource = readFileSync(
  new URL("../src/actions.ts", import.meta.url),
  "utf8",
);
const configSource = readFileSync(
  new URL("../src/config.ts", import.meta.url),
  "utf8",
);
const editorContextSource = readFileSync(
  new URL("../src/editorContext.ts", import.meta.url),
  "utf8",
);

test("extension contributes saved model profile settings and select command", () => {
  const properties = packageJson.contributes.configuration.properties;
  assert.ok(properties["iaedu.modelProfiles"]);
  assert.ok(properties["iaedu.activeModelProfileId"]);
  assert.equal(
    properties["iaedu.modelConfigPath"].default,
    "~/.secrets/IAEDU.md",
  );
  assert.ok(
    packageJson.contributes.commands.some(
      (command) => command.command === "iaedu.selectModelProfile",
    ),
  );
  assert.ok(
    packageJson.contributes.commands.some(
      (command) => command.command === "iaedu.loadModelConfigFile",
    ),
  );
  assert.ok(
    packageJson.contributes.commands.some(
      (command) => command.command === "iaedu.saveModelConfigFile",
    ),
  );
});

test("webview can save and switch IAEDU model profiles", () => {
  assert.match(extensionSource, /id="modelSelect"/);
  assert.match(extensionSource, /id="configProfileName"/);
  assert.match(extensionSource, /id="configLoadFile"/);
  assert.match(extensionSource, /id="configSaveFile"/);
  assert.match(webviewScript, /type: "selectModelProfile"/);
  assert.match(webviewScript, /type: "loadModelConfigFile"/);
  assert.match(webviewScript, /type: "saveModelConfigFile"/);
  assert.match(webviewScript, /profileName/);
});

test("model registry is stored outside workspace settings", () => {
  assert.match(configSource, /API_KEY_SECRET_PREFIX/);
  assert.match(configSource, /SecretStorage/);
  assert.match(configSource, /MODEL_CONFIG_PATH_CONFIG/);
  assert.match(configSource, /writeModelConfigFile/);
  assert.match(configSource, /readModelConfigFile/);
  assert.doesNotMatch(
    JSON.stringify(
      packageJson.contributes.configuration.properties["iaedu.modelProfiles"],
    ),
    /apiKey/i,
  );
});

test("workspace IAEDU.md instructions are included automatically", () => {
  assert.match(editorContextSource, /getWorkspaceInstructions/);
  assert.match(editorContextSource, /IAEDU\.md/);
  assert.match(
    editorContextSource,
    /Do not propose local actions just to read IAEDU\.md/,
  );
  assert.match(extensionSource, /getWorkspaceInstructions/);
  assert.match(extensionSource, /workspaceInstructions\?\.text/);
});

test("auto-accept allows guarded Stata batch do-file commands", () => {
  assert.match(actionsSource, /isAutoAcceptStataCommand/);
  assert.match(actionsSource, /stata.*stata-mp.*statase/s);
  assert.match(actionsSource, /\.endsWith\("\.do"\)/);
  assert.match(actionsSource, /isWorkspaceFile\(doFile, cwd, workspaceRoot, \["\.do"\]\)/);
});

test("auto-accept supports guarded append-file edits", () => {
  assert.match(actionsSource, /type: "appendFile"/);
  assert.match(actionsSource, /appendWorkspaceFile/);
  assert.match(actionsSource, /isAutoAcceptTextAppendPath/);
  assert.match(editorContextSource, /use appendFile instead of a shell or Python command/);
  assert.match(webviewScript, /stripLocalActionBlocks/);
});

test("auto-accept allows guarded Python, R, and Julia workspace commands", () => {
  assert.match(actionsSource, /isAutoAcceptPythonCommand/);
  assert.match(actionsSource, /isAutoAcceptRCommand/);
  assert.match(actionsSource, /isAutoAcceptJuliaCommand/);
  assert.match(actionsSource, /"pytest"/);
  assert.match(actionsSource, /"rscript"/);
  assert.match(actionsSource, /"julia"/);
  assert.match(actionsSource, /isWorkspaceFile\(tokens\[scriptIndex\], cwd, workspaceRoot, \["\.jl"\]\)/);
});

test("assistant responses can be copied from the webview", () => {
  assert.match(webviewScript, /className = "copy-message"/);
  assert.match(webviewScript, /type: "copyText"/);
  assert.match(extensionSource, /vscode\.env\.clipboard\.writeText/);
});
