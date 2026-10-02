import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

let workflowWorkspace;
export const getWorkflowWorkspace = () => workflowWorkspace;

// ponytail: reuse the production generator; import it if it moves into a module.
export default async function ({ vars }) {
  if (vars.workflow_step > 1) {
    assert(workflowWorkspace, 'Run the complete workflow, starting with preparation');
    return { prompt: vars.scenario, config: { working_dir: workflowWorkspace } };
  }
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('  function agentPrompt() {');
  const end = app.indexOf('\n  async function importAgentLink()', start);
  assert(start >= 0 && end > start, 'Production prompt generator moved');
  const prompt = runInNewContext(`${app.slice(start, end)}\nagentPrompt()`, {
    URL,
    location: { href: 'https://vector-dusk.example/index.html' },
  });
  const workingDir = await mkdtemp(path.join(tmpdir(), 'vector-dusk-promptfoo-'));
  if (vars.fixture) {
    assert(['svg', 'android'].includes(vars.fixture), 'Unknown eval fixture');
    await cp(new URL(`./fixtures/${vars.fixture}/`, import.meta.url), workingDir, {
      recursive: true,
    });
  }
  if (vars.workflow_step === 1) workflowWorkspace = workingDir;
  return {
    prompt: `${prompt}\n\nUser context:\n${vars.scenario}`,
    config: { working_dir: workingDir },
  };
}
