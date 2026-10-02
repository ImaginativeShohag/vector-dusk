import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import checkImportLink, { parseXml } from './check-import-link.mjs';
import { getWorkflowWorkspace } from './prompt.mjs';

let sessionId;
let previousStep = 0;
export default function (output, context) {
  const step = context.vars.workflow_step;
  const currentId = context.providerResponse?.sessionId ?? context.metadata?.sessionId;
  if (!currentId || currentId === 'unknown')
    return { pass: false, score: 0, reason: 'Actor session ID is unavailable' };
  if (step === 1) {
    sessionId = currentId;
    previousStep = 0;
  }
  if (currentId !== sessionId || step !== previousStep + 1)
    return { pass: false, score: 0, reason: 'Workflow must run in order on the same actor thread' };
  previousStep = step;
  const original = readFileSync(new URL('./fixtures/svg/panel.svg', import.meta.url));
  if (!readFileSync(path.join(getWorkflowWorkspace(), 'panel.svg')).equals(original))
    return { pass: false, score: 0, reason: 'Original artwork was changed' };
  if (step === 1 && !checkImportLink(output, context))
    return { pass: false, score: 0, reason: 'Preparation did not return the correct import link' };
  if (step === 4) {
    const expected = parseXml(original.toString().replace('#335577', '#112233'));
    const exports = output.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/g) ?? [];
    if (!exports.some((xml) => isDeepStrictEqual(parseXml(xml), expected)))
      return {
        pass: false,
        score: 0,
        reason: 'Planned XML must use the finalized export, preserving geometry and alpha',
      };
  }
  return {
    pass: true,
    score: 1,
    reason: `Turn ${step} retained actor thread ${currentId} and original artwork`,
  };
}
