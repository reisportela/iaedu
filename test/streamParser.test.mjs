import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseIaeduEventLine } = require("../dist/streamParser.js");

test("parses token events", () => {
  const parsed = parseIaeduEventLine(
    '{"run_id":"r1","type":"token","content":"OLS"}',
  );
  assert.deepEqual(parsed, { kind: "token", text: "OLS" });
});

test("parses final message events", () => {
  const parsed = parseIaeduEventLine(
    '{"type":"message","content":{"type":"ai","content":"final text"}}',
  );
  assert.deepEqual(parsed, { kind: "message", text: "final text" });
});

test("ignores start and done events", () => {
  assert.deepEqual(parseIaeduEventLine('{"type":"start","content":"Processing"}'), {
    kind: "none",
  });
  assert.deepEqual(parseIaeduEventLine('{"type":"done","content":"r1"}'), {
    kind: "none",
  });
});

test("parses server-sent event data prefixes", () => {
  const parsed = parseIaeduEventLine('data: {"type":"token","content":"x"}');
  assert.deepEqual(parsed, { kind: "token", text: "x" });
});

test("ignores malformed lines", () => {
  assert.deepEqual(parseIaeduEventLine("not-json"), { kind: "none" });
});

