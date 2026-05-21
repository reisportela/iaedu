# IAEDU Agent for VS Code

IAEDU Agent for VS Code is a local VS Code extension that connects an editor workspace to the IAEDU `agent-chat` API. It is designed for users who already have access to IAEDU through an eligible institution and want to use IAEDU while reading, writing, analysing or editing project files in VS Code.

The extension is currently available only for VS Code.

## What It Does

- Opens an IAEDU chat panel in the VS Code side bar.
- Sends ordinary chat prompts to the IAEDU API.
- Can include the current selection or active file as local context.
- Streams IAEDU responses into the panel.
- Renders Markdown and LaTeX maths in chat responses.
- Keeps one `thread_id` per workspace and can start a new thread.
- Provides three working modes: `ask`, `plan` and `agent`.
- Stores the API key in VS Code SecretStorage, not in repository files.
- Supports optional `.env` import for local development.
- In `agent` mode, can apply proposed local actions only after guardrails and, where needed, user review.

No IAEDU endpoint, channel ID, API key or institution-specific configuration is included in this repository.

## IAEDU Background

IAEDU is an FCT/FCCN platform for higher education and research in Portugal. Public IAEDU material describes it as a service that centralises access to multiple artificial intelligence models and uses federated institutional authentication. Access is intended for users from participating institutions and is subject to IAEDU's responsible use policy.

Official IAEDU sources:

- IAEDU home page: <https://www.iaedu.pt/>
- IAEDU usage page: <https://iaedu.pt/pt/como-utilizar>
- IAEDU documentation: <https://docs.iaedu.pt/>
- IAEDU access guide: <https://docs.iaedu.pt/books/bem-vindo-ao-iaedu/page/como-aceder>
- IAEDU agents guide: <https://docs.iaedu.pt/books/funcionalidade-agentes/page/como-criar-agentes>
- IAEDU API example: <https://docs.iaedu.pt/books/funcionalidade-api/page/exemplo-python>

## How IAEDU Access Works

1. Go to IAEDU from <https://www.iaedu.pt/> or directly to <https://chat.iaedu.pt/>.
2. Sign in with institutional credentials. IAEDU uses federated authentication, so users do not need to create a separate IAEDU account.
3. Choose the AI model that fits the task. IAEDU documentation explains that different models have different strengths, so the model choice should match the academic, research or coding task.
4. For agent workflows, create or configure an IAEDU agent in the IAEDU web platform. The IAEDU agent guide covers naming the agent, describing its purpose, writing a system prompt, choosing a model, optionally adding knowledge-base files and testing with realistic questions.
5. Obtain the API connection details from IAEDU for the model or agent you intend to use. The API example in the IAEDU documentation shows that an integration needs an API endpoint, an API key and a `channel_id`; the API key is sent as an `x-api-key` header and the request includes `channel_id`, `thread_id`, `user_info` and `message`.

Availability of API access may depend on the selected model, IAEDU configuration and institutional policy. This extension does not request, generate or bundle IAEDU credentials.

## Extension Modes

`ask`

Use this for ordinary questions. The extension can include local context, but it does not ask IAEDU to propose file edits or commands.

`plan`

Use this for read-only analysis and implementation planning. This mode is useful for asking IAEDU to inspect context, explain problems, propose a plan and list validation steps.

`agent`

Use this when IAEDU may propose local actions. The extension recognises fenced `iaedu-action` blocks and presents the actions in the panel. Local actions are constrained by guardrails before anything is applied.

Supported local action format:

```iaedu-action
{
  "actions": [
    {
      "type": "writeFile",
      "path": "relative/path.txt",
      "content": "content"
    },
    {
      "type": "replaceSelection",
      "content": "new text"
    },
    {
      "type": "runCommand",
      "command": "npm test"
    }
  ]
}
```

## Guardrails

The extension is deliberately conservative. Local actions must stay inside the open workspace. The extension blocks or requires review for sensitive paths and commands.

Auto-accept is available only in `agent` mode and applies only low-risk actions. It does not allow bulk-style writes, outside-workspace edits, system package installation, system file changes, destructive shell patterns, privileged commands or unsafe command pipes.

Examples of blocked or restricted behaviour include:

- writing outside the workspace;
- writing to protected paths such as `.git`, `.ssh` or environment/configuration files without review;
- large automatic writes;
- `sudo`, system package managers, service managers and recursive permission changes;
- destructive Git commands such as `git reset --hard` and `git clean -f`;
- download-and-execute command patterns such as `curl ... | sh`.

## Install Without Git

Users do not need to use Git if a packaged `.vsix` file is available from the GitHub Releases page.

Recommended route for most users:

1. Open the repository page in a browser.
2. Go to `Releases`.
3. Download the latest `iaedu-agent-*.vsix` file.
4. Open VS Code.
5. Open the Extensions view.
6. Select `...` and choose `Install from VSIX...`.
7. Select the downloaded `.vsix` file.
8. Reload VS Code when prompted.

The GitHub `Code` > `Download ZIP` option downloads the source code, not an installable extension package. It can still be used, but the user must build the `.vsix` locally:

1. Download the repository ZIP from GitHub.
2. Unzip it.
3. Open a terminal in the unzipped folder.
4. Run:

```bash
npm install
npm run package
```

5. Install the generated `.vsix` file from VS Code with `Extensions` > `...` > `Install from VSIX...`.

For non-technical users, publishing the `.vsix` as a GitHub Release asset is the simplest route.

This repository includes a GitHub Actions workflow that builds and tests the extension, uploads the `.vsix` as a workflow artefact, and attaches it automatically to a published GitHub Release.

## Install From Source

Requirements:

- VS Code 1.100 or newer;
- Node.js and npm;
- IAEDU API endpoint, `channel_id` and API key from IAEDU.

Clone the repository:

```bash
git clone https://github.com/reisportela/iaedu.git
cd iaedu
```

Install dependencies and compile:

```bash
npm install
npm run compile
```

Run tests:

```bash
npm run test
```

Build a local VSIX:

```bash
npm run package
```

Install the generated package:

```bash
code --install-extension iaedu-agent-0.1.10.vsix --force
```

Reload VS Code after installing.

## Development In VS Code

Open this repository in VS Code and press `F5`. The included launch configuration starts an Extension Development Host and compiles the extension before launch.

## Configure The Extension

Open the Command Palette and run:

```text
IAEDU: Open Chat
```

In the IAEDU panel, choose `sign in` and enter:

- IAEDU endpoint;
- `channel_id`;
- API key.

The endpoint and `channel_id` are stored in VS Code workspace settings. The API key is stored in VS Code SecretStorage.

You can also configure values through Command Palette commands:

```text
IAEDU: Sign In / Configure API
IAEDU: Set Endpoint
IAEDU: Set Channel ID
IAEDU: Set API Key
```

For local development, copy `.env.example` to `.env`, fill in your own values and run:

```text
IAEDU: Import Settings from .env
```

Never commit `.env` or real IAEDU credentials.

## Use The Extension

Open the IAEDU panel from the side bar or run:

```text
IAEDU: Open Chat
```

Type a prompt and choose the mode:

- `ask` for direct questions;
- `plan` for read-only planning;
- `agent` for guarded local actions.

Use `active file` to include the current editor file as context. You can also right-click selected text and use:

```text
IAEDU: Ask About Selection
```

### Mathematical Expressions

The response panel renders LaTeX mathematical expressions with KaTeX after Markdown rendering. It supports common inline and display formats:

- inline: `$x^2 + y^2 = z^2$`
- inline: `\(x^2 + y^2 = z^2\)`
- display: `$$\int_0^1 x^2\,dx = \frac{1}{3}$$`
- display: `\[\int_0^1 x^2\,dx = \frac{1}{3}\]`

Math rendering is skipped inside code blocks and inline code so programming examples remain unchanged.

To reset the IAEDU conversation thread for the current workspace, use:

```text
IAEDU: Start New Thread
```

To remove local IAEDU connection settings and the stored API key:

```text
IAEDU: Sign Out
```

## Repository Contents

- `src/`: TypeScript extension source.
- `media/`: webview JavaScript, CSS and icons.
- `test/`: stream parser tests.
- `.vscode/`: development launch/task configuration.
- `.vscodeignore`: files excluded from the VSIX package.
- `.env.example`: placeholder IAEDU configuration keys.
- `LICENSE`: MIT licence.

Generated folders and artefacts such as `node_modules/`, `dist/` and `*.vsix` are ignored and should not be committed.

## Licence

This project is released under the MIT licence. See `LICENSE`.
