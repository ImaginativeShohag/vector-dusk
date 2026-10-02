# Prompt evals

The target is to verify that an LLM understands the production **Copy prompt for agent** instructions and chooses the correct next action during a Vector Dusk handoff.

## Run

```sh
npm ci
codex --version
codex login status
export VECTOR_DUSK_CODEX_BIN="$(command -v codex)"
npm run eval:validate
npm run eval
npm run eval:workflow
npm run eval:view
```

Ensure `codex --version` reports CLI 0.156.1 or newer for GPT-6 Luna. If it reports an older copy, fix which installation your shell selects before continuing. Sign in with `codex login` if needed. The exported variable selects that same executable for Promptfoo, which otherwise uses its bundled CLI. Leave `OPENAI_API_KEY` and `CODEX_API_KEY` unset to use your ChatGPT login. Promptfoo runs locally without a subscription; actor and grader calls consume Codex usage. The actor uses `gpt-6-luna`; the judge uses `gpt-6-sol`. Both are configured in `promptfooconfig.yaml`. Artifact assertions run locally without a model. npm scripts use the project-local Node runtime required by Promptfoo.

Export `VECTOR_DUSK_CODEX_BIN` in every new terminal before running live evals. Both eval commands check the selected CLI before starting; a missing variable or unsupported `--ignore-user-config` flag stops the command before any cases run. Run the export directly in your terminal, outside an npm script, so it selects your installed CLI rather than Promptfoo's bundled copy.

Run one case or repeat the suite:

```sh
npm run eval -- --filter-first-n 1
npm run eval -- --repeat 3
```

The independent suite runs seven fresh conversations. `npm run eval:workflow` runs four ordered turns on one persistent actor thread: prepare, still editing, finalized without an export, and finalized export supplied. Repeat the workflow by running that command again. Keep all four turns in order; case filters and `--repeat` do not preserve this conversation sequence.

CI validates both configurations only. Live runs require your local login.

## Target and scoring

| Scenario                       | Required decision                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No browser before finalization | Read the SVG fixture and generate its import link, explain the limitation, and wait for finalization.                                                  |
| Missing input file             | Request the missing file or its contents without inventing artwork or claiming success.                                                                |
| Review still in progress       | Wait for finalization before applying artwork.                                                                                                         |
| Finalized tab inaccessible     | Request the exported file instead of reopening the original import link.                                                                               |
| Oversized compressed link      | Use Paste XML or Import vectors without truncating valid artwork.                                                                                      |
| Android references             | Generate a correct XML import link with resolved color or matching resource XML; wait for finalization and plan the drawable-night destination.        |
| Import error                   | Request rejected source for inspection, diagnosis or repair, or corrected SVG, without claiming success; exact acknowledgment wording is not required. |

Each case uses the production prompt generator from `app.js`, a placeholder editor URL, and a user scenario. A fresh read-only Codex thread starts in its own temporary directory. The SVG and Android cases receive copies of the files in `fixtures/svg/` and `fixtures/android/`, preserving project paths. Other cases start with an empty directory. A separate Codex thread grades each response against the case criteria. Requesting the export is checked when the user finalizes, not required in the preparation response. Expected answers are supplied only to the grader.

Artifact assertions decode the returned import links and check the version, filename and size limits. SVG content must match the fixture bytes. Android XML is parsed and compared with the fixture, preserving geometry and alpha; the color must either be resolved from the matching colors.xml or retain its reference with matching resource XML supplied alongside the link or a local colors.xml file link whose contents are verified. Local file links must resolve to the resource file inside an eval temporary workspace; missing files, incorrect contents and symlinks outside those workspaces are rejected. Formatting and attribute order do not affect the Android comparison. A separate colors.xml artwork link does not count as resource delivery: the artwork endpoint accepts SVG or vector XML, not a resources root. These checks require artifacts, not verbal assurances.

`npm run eval:validate` checks fixture copying, workspace isolation, valid artifacts and local resource handoffs, plus rejection of changed colors, lost alpha, changed geometry, malformed XML and unusable resource links before validating configuration.

Passing requires the specified decision and no fabricated browser, export, validation or file-write claims. Review grader explanations and spot-check judgments: an LLM judge can be wrong. Login, model and runtime errors are setup errors, not prompt failures. A full-suite baseline should have seven passes and zero errors; repeated trials measure consistency.

## Scope

The independent cases test responses and decisions. The workflow checks real actor-thread continuity, waiting across turns, requesting the export after finalization, using the supplied edited XML rather than the original, and leaving the source unchanged. It uses a read-only workspace and no browser: browser rendering, same-tab retrieval and completed project writes still require a controlled browser and writable workflow test.

The CLI wrapper uses `--ignore-user-config` to skip your personal config.toml, including its MCP definitions, while retaining authentication. The selected executable path stays in your shell environment; personal server names and paths stay out of shared configuration. System, managed or project configuration can still apply, so ensure those layers do not supply browser tools for these cases. Temporary directories can be removed after a run.

Caching, telemetry and result sharing are disabled. Results stay in the ignored project-local `.promptfoo/` database and are available through `npm run eval:view`. SDK instruction and tool overhead counts toward model usage, including cached tokens.

Eval dependencies are excluded from the static site build. The installed development dependency tree has seven high-severity npm audit entries, including transitive entries; the production dependency audit reports zero.
