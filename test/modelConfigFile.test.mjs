import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_MODEL_CONFIG_PATH,
  parseModelConfigFile,
  serializeModelConfigFile,
} = require("../dist/modelConfigFile.js");

test("parses IAEDU model config files from ~/.secrets", () => {
  const profiles = parseModelConfigFile(`
Model_Name=IAEDU:ChatGPT 5.5
Endpoint=https://api.iaedu.pt/agent-chat//api/v1/agent/a/stream
API_KEY=first-key
Channel_ID=first-channel

Model_Name=IAEDU:Claude Opus 4.7
Endpoint=https://api.iaedu.pt/agent-chat//api/v1/agent/b/stream
API_KEY=second-key
Channel_ID=second-channel
`);

  assert.equal(DEFAULT_MODEL_CONFIG_PATH, "~/.secrets/IAEDU.md");
  assert.deepEqual(profiles, [
    {
      id: "iaedu-chatgpt-5-5",
      name: "IAEDU:ChatGPT 5.5",
      endpoint: "https://api.iaedu.pt/agent-chat//api/v1/agent/a/stream",
      apiKey: "first-key",
      channelId: "first-channel",
    },
    {
      id: "iaedu-claude-opus-4-7",
      name: "IAEDU:Claude Opus 4.7",
      endpoint: "https://api.iaedu.pt/agent-chat//api/v1/agent/b/stream",
      apiKey: "second-key",
      channelId: "second-channel",
    },
  ]);
});

test("serializes IAEDU model config files without workspace JSON", () => {
  const text = serializeModelConfigFile([
    {
      id: "default",
      name: "GPT 5.5",
      endpoint: "https://api.iaedu.pt/agent-chat/example",
      apiKey: "secret",
      channelId: "channel",
    },
  ]);

  assert.equal(
    text,
    [
      "Model_Name=GPT 5.5",
      "Endpoint=https://api.iaedu.pt/agent-chat/example",
      "API_KEY=secret",
      "Channel_ID=channel",
      "",
    ].join("\n"),
  );
});
