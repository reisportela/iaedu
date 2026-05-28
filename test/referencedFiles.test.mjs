import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  findPromptPathReferences,
  getReferencedFileContext,
  resolvePromptFileCandidates,
} = require("../dist/referencedFiles.js");

test("finds absolute and relative supported file paths in prompts", () => {
  const paths = findPromptPathReferences(
    "Estuda /home/mangelo/Documents/Alunos/Tadeu/6.Segundo_Paper_V07.pdf e docs/notas.md.",
  );

  assert.deepEqual(paths, [
    "/home/mangelo/Documents/Alunos/Tadeu/6.Segundo_Paper_V07.pdf",
    "docs/notas.md",
  ]);
});

test("resolves relative prompt files against workspace folders", () => {
  const root = mkdtempSync(join(tmpdir(), "iaedu-prompt-files-"));
  try {
    const candidates = resolvePromptFileCandidates(
      "Rever docs/notas.md e capitulo.pdf",
      [root],
    );

    assert.deepEqual(candidates, [
      {
        rawPath: "docs/notas.md",
        filePath: join(root, "docs/notas.md"),
      },
      {
        rawPath: "capitulo.pdf",
        filePath: join(root, "capitulo.pdf"),
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("includes explicitly referenced text files as local context", async () => {
  const root = mkdtempSync(join(tmpdir(), "iaedu-prompt-files-"));
  try {
    const filePath = join(root, "notas.md");
    writeFileSync(
      filePath,
      "# Manuscript notes\n\nThis chapter studies a policy reform.",
    );

    const context = await getReferencedFileContext(
      `Produz um relatorio com base em ${filePath}.`,
      {
        enabled: true,
        maxFiles: 4,
        maxChars: 10000,
      },
      [],
    );

    assert.ok(context);
    assert.deepEqual(context.userContext.promptFilesIncluded, [filePath]);
    assert.match(context.text, /Local referenced file context/);
    assert.match(context.text, /This chapter studies a policy reform/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not include prompt files when the feature is disabled", async () => {
  const context = await getReferencedFileContext(
    "Estuda /tmp/example.md.",
    {
      enabled: false,
      maxFiles: 4,
      maxChars: 10000,
    },
    [],
  );

  assert.equal(context, undefined);
});

test("large referenced files are excerpted instead of sent in full", async () => {
  const root = mkdtempSync(join(tmpdir(), "iaedu-prompt-files-"));
  try {
    const filePath = join(root, "chapter.md");
    writeFileSync(filePath, `${"A".repeat(4000)}\n\n${"B".repeat(4000)}`);

    const context = await getReferencedFileContext(
      `Produz um relatorio com base em ${filePath}.`,
      {
        enabled: true,
        maxFiles: 4,
        maxChars: 1200,
      },
      [],
    );

    assert.ok(context);
    assert.equal(context.userContext.promptFilesTruncated, true);
    assert.match(context.text, /Status: excerpted to fit request limits/);
    assert.match(context.text, /omitted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
