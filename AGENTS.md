# AGENTS.md

## Repository Source Of Truth

- The canonical repository for the VS Code extension is this folder:
  `/home/mangelo/Documents/GitHub/iaedu`.
- The user may also work from `/home/mangelo/Documents/AI/IAEDU`. That folder
  contains experiments, data, credentials, outputs, and an older local
  `iaedu-vscode-extension` snapshot.
- Do not push or share directly from
  `/home/mangelo/Documents/AI/IAEDU/iaedu-vscode-extension`.
- As of 2026-05-21, the local snapshot in
  `/home/mangelo/Documents/AI/IAEDU/iaedu-vscode-extension` was older
  (`package.json` version `0.1.8`) than this repository (`package.json` version
  `0.1.11`).
- For publication, packaging, releases, or GitHub sharing, first update this
  repository, then commit and push from here.

## Project Context

- This repository contains the `iaedu-agent` VS Code extension.
- The extension connects VS Code to the IAEDU `agent-chat` API.
- When an open VS Code workspace contains an `IAEDU.md` file, every IAEDU model
  profile/model used by the extension should read and apply that file as local
  project instructions, in the same spirit that Codex reads `AGENTS.md`.
- `IAEDU.md` is optional. Do not fail requests when it is absent, and do not
  search for it outside the open VS Code workspace.
- Do not commit IAEDU API keys, real endpoints, `channel_id` values, local
  `.env` files, student data, research data, or generated local outputs.
- Keep institution-specific configuration out of the repository. Use
  `.env.example`, README instructions, and VS Code SecretStorage patterns
  instead.

## Guardrails

- Treat this repository as the only source that should be pushed or shared.
  Never copy files back from `/home/mangelo/Documents/AI/IAEDU` without first
  checking whether they are experimental, stale, private, or generated.
- Do not weaken the extension's local-action safety model. Any `agent` mode
  change must preserve review gates for risky writes and commands, keep actions
  inside the open VS Code workspace, and block destructive or privileged shell
  patterns.
- Do not add automatic execution of model-proposed commands unless the command
  is low risk, visible to the user, and covered by the existing guardrail logic.
- Do not store credentials in source code, tests, fixtures, package metadata,
  screenshots, README examples, or release artefacts. Use placeholders in docs
  and `.env.example`.
- Do not commit `.env`, generated logs, local IAEDU responses, research data,
  student data, Stata datasets, output figures, or local test workspaces.
- Keep README and UI text institution-neutral unless the user explicitly asks
  for institution-specific packaging.
- Preserve compatibility with VS Code `^1.100.0` unless there is a deliberate
  version bump in `package.json` and README.
- When changing API request/response handling, keep `thread_id`, `channel_id`,
  `user_info`, streaming, Markdown rendering, and LaTeX rendering behaviour
  covered by tests or manual validation notes.
- When adding or changing `IAEDU.md` handling, ensure the file is applied to
  every saved model profile and every request path, not only to the currently
  selected model in the chat panel.
- When changing packaging, release, or GitHub Actions files, verify that the
  generated `.vsix` remains installable and does not include secrets or local
  workspace files.
- Keep changes small and reviewable. Avoid broad refactors unless they are
  required for the requested feature or bug fix.

## Local Installation After Revisions

- Whenever the extension is revised on this computer, update the locally
  installed VS Code extension before handing the work back, so the user can see
  the changes immediately.
- The normal local validation/install loop is:
  1. Run `npm run compile`.
  2. Run `npm run test`.
  3. Run `npm run package`.
  4. Install the generated package with the local VS Code CLI, for example
     `code --install-extension iaedu-agent-<version>.vsix --force`.
- If the `code` CLI is not available, report that clearly and leave the freshly
  generated `.vsix` path in the final response.

## Before Push Or Sharing

1. Work from `/home/mangelo/Documents/GitHub/iaedu`.
2. Check `git status --short --branch` and review the intended diff.
3. Confirm `package.json`, `package-lock.json`, `README.md`, `src/`, `media/`,
   `test/`, `.github/`, and `.vscodeignore` reflect the version to share.
4. If dependencies are missing, run `npm install`.
5. Run `npm run compile`.
6. Run `npm run test`.
7. For an installable extension package, run `npm run package`.
8. Treat generated `.vsix` files as release assets unless the user explicitly
   asks to version them in Git.
