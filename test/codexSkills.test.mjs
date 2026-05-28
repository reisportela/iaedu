import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_CODEX_EXTRA_SKILLS_PATHS,
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
      extraPaths: [],
      includePluginSkills: false,
    });
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["data-section-editor", "paper-renamer"],
    );

    const context = getCodexSkillContext("Reve a seccao de dados.", {
      enabled: true,
      skillsPath: root,
      extraPaths: [],
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

test("Codex skills can be disabled", () => {
  const context = getCodexSkillContext("Use a skill.", {
    enabled: false,
    skillsPath: DEFAULT_CODEX_SKILLS_PATH,
    extraPaths: DEFAULT_CODEX_EXTRA_SKILLS_PATHS,
    includePluginSkills: false,
    maxSkills: 3,
    maxChars: 12000,
  });

  assert.equal(context, undefined);
});

test("extra Codex skill roots are merged and override duplicate skill names", () => {
  const baseRoot = mkdtempSync(join(tmpdir(), "iaedu-codex-skills-base-"));
  const extraRoot = mkdtempSync(join(tmpdir(), "iaedu-codex-skills-extra-"));
  try {
    const baseSkillDir = join(baseRoot, "economics-supervisor-review");
    const extraSkillDir = join(extraRoot, "economics-supervisor-review");
    mkdirSync(baseSkillDir, { recursive: true });
    mkdirSync(extraSkillDir, { recursive: true });
    writeFileSync(
      join(baseSkillDir, "SKILL.md"),
      `---
name: economics-supervisor-review
description: "Base review skill."
---

# Base Review
`,
    );
    writeFileSync(
      join(extraSkillDir, "SKILL.md"),
      `---
name: economics-supervisor-review
description: "Portela thesis chapter review skill."
---

# Portela Review
`,
    );

    const skills = discoverCodexSkills({
      skillsPath: baseRoot,
      extraPaths: [extraRoot],
      includePluginSkills: false,
    });
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["economics-supervisor-review"],
    );
    assert.match(skills[0].body, /Portela Review/);

    const context = getCodexSkillContext("Relatorio de orientador para capitulo de tese.", {
      enabled: true,
      skillsPath: baseRoot,
      extraPaths: [extraRoot],
      includePluginSkills: false,
      maxSkills: 1,
      maxChars: 6000,
    });

    assert.ok(context);
    assert.deepEqual(context.userContext.codexSkillsSelected, [
      "economics-supervisor-review",
    ]);
    assert.match(context.text, /Portela thesis chapter review skill/);
  } finally {
    rmSync(baseRoot, { recursive: true, force: true });
    rmSync(extraRoot, { recursive: true, force: true });
  }
});
