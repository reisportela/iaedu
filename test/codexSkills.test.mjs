import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_CODEX_SKILLS_PATH,
  discoverCodexSkills,
  getCodexSkillContext,
  parseCodexSkillFile,
} = require("../dist/codexSkills.js");

test("parses Codex SKILL.md frontmatter", () => {
  const skill = parseCodexSkillFile(
    "/tmp/data-section-editor/SKILL.md",
    `---
name: data-section-editor
description: "Review data sections carefully."
---

# Data Section Editor

Use this skill for data sections.
`,
  );

  assert.equal(skill.name, "data-section-editor");
  assert.equal(skill.description, "Review data sections carefully.");
  assert.equal(skill.source, "/tmp/data-section-editor/SKILL.md");
});

test("discovers and selects relevant Codex skills", () => {
  const root = mkdtempSync(join(tmpdir(), "iaedu-codex-skills-"));
  try {
    const dataSkillDir = join(root, "data-section-editor");
    const renameSkillDir = join(root, "paper-renamer");
    mkdirSync(dataSkillDir, { recursive: true });
    mkdirSync(renameSkillDir, { recursive: true });
    writeFileSync(
      join(dataSkillDir, "SKILL.md"),
      `---
name: data-section-editor
description: "Review data, sample, variables and descriptive statistics sections."
---

# Data Section Editor

Use this skill when reviewing a data section.
`,
    );
    writeFileSync(
      join(renameSkillDir, "SKILL.md"),
      `---
name: paper-renamer
description: "Rename academic PDF files from metadata."
---

# Paper Renamer

Use this skill when renaming PDFs.
`,
    );

    const skills = discoverCodexSkills({
      skillsPath: root,
      includePluginSkills: false,
    });
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["data-section-editor", "paper-renamer"],
    );

    const context = getCodexSkillContext("Reve a seccao de dados.", {
      enabled: true,
      skillsPath: root,
      includePluginSkills: false,
      maxSkills: 1,
      maxChars: 6000,
    });

    assert.ok(context);
    assert.deepEqual(context.userContext.codexSkillsSelected, [
      "data-section-editor",
    ]);
    assert.match(context.text, /Codex skill: data-section-editor/);
    assert.match(context.text, /Available Codex skills/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex skills are opt-in", () => {
  const context = getCodexSkillContext("Use a skill.", {
    enabled: false,
    skillsPath: DEFAULT_CODEX_SKILLS_PATH,
    includePluginSkills: false,
    maxSkills: 3,
    maxChars: 12000,
  });

  assert.equal(context, undefined);
});
