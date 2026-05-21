import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webviewScript = readFileSync(
  new URL("../media/main.js", import.meta.url),
  "utf8",
);
const extensionSource = readFileSync(
  new URL("../src/extension.ts", import.meta.url),
  "utf8",
);

test("webview response renderer protects maths before Markdown rendering", () => {
  assert.match(webviewScript, /function render\(element, text\)/);
  assert.match(webviewScript, /extractMathSegments\(text \|\| ""\)/);
  assert.match(webviewScript, /element\.innerHTML = md\.render/);
  assert.match(webviewScript, /insertMathSegments\(element, protectedMath\.segments\)/);
});

test("webview response renderer uses direct KaTeX rendering for protected maths", () => {
  assert.match(webviewScript, /renderMath\(element\)/);
  assert.match(webviewScript, /window\.katex\.render\(segment\.content, node/);
  assert.match(webviewScript, /displayMode: segment\.display/);
});

test("webview math renderer supports common inline and display delimiters", () => {
  assert.match(webviewScript, /\{ left: "\$\$", right: "\$\$", display: true \}/);
  assert.match(webviewScript, /\{ left: "\\\\\[", right: "\\\\\]", display: true \}/);
  assert.match(webviewScript, /\{ left: "\\\\\(", right: "\\\\\)", display: false \}/);
  assert.match(webviewScript, /\{ left: "\$", right: "\$", display: false \}/);
});

test("webview math renderer avoids code blocks and tolerates incomplete maths", () => {
  assert.match(webviewScript, /@@IAEDU_CODE_/);
  assert.match(webviewScript, /codeSegments\.push\(match\)/);
  assert.match(webviewScript, /throwOnError: false/);
  assert.match(webviewScript, /processEscapes: true/);
  assert.match(webviewScript, /processEnvironments: true/);
  assert.match(webviewScript, /"pre"/);
  assert.match(webviewScript, /"code"/);
});

test("extension loads KaTeX assets into the response webview", () => {
  assert.match(extensionSource, /katex\.min\.css/);
  assert.match(extensionSource, /katex\.min\.js/);
  assert.match(extensionSource, /auto-render\.min\.js/);
});
