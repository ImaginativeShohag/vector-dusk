import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';
import prompt from './prompt.mjs';
import checkImportLink from './check-import-link.mjs';
import checkWorkflow from './check-workflow.mjs';

const checkSvgLink = (output) => checkImportLink(output, { vars: { fixture: 'svg' } });
const checkAndroidLink = (output) => checkImportLink(output, { vars: { fixture: 'android' } });

const workspaces = [];
const wrapper = fileURLToPath(new URL('./codex.sh', import.meta.url));
const wrapperEnv = { ...process.env, VECTOR_DUSK_CODEX_BIN: '' };
const missingCli = spawnSync(wrapper, ['exec', '--help'], { env: wrapperEnv, encoding: 'utf8' });
assert.equal(missingCli.status, 1);
assert.match(missingCli.stderr, /export VECTOR_DUSK_CODEX_BIN="\$\(command -v codex\)"/);
const selectedCli = spawnSync(wrapper, ['exec', '--help'], {
  env: { ...wrapperEnv, VECTOR_DUSK_CODEX_BIN: '/bin/echo' },
  encoding: 'utf8',
});
assert.equal(selectedCli.status, 0);
assert.equal(selectedCli.stdout.trim(), 'exec --help --ignore-user-config');
try {
  for (const [fixture, files] of [
    ['svg', ['panel.svg']],
    ['android', ['app/src/main/res/drawable/panel.xml', 'app/src/main/res/values/colors.xml']],
    [undefined, []],
  ]) {
    const result = await prompt({ vars: { fixture, scenario: 'Check workspace setup.' } });
    const workspace = result.config.working_dir;
    workspaces.push(workspace);
    for (const file of files) {
      assert.equal(
        await readFile(path.join(workspace, file), 'utf8'),
        await readFile(new URL(`./fixtures/${fixture}/${file}`, import.meta.url), 'utf8'),
      );
    }
    assert.deepEqual(
      (await readdir(workspace)).sort(),
      files.length ? [fixture === 'svg' ? 'panel.svg' : 'app'] : [],
    );
  }
  assert.equal(new Set(workspaces).size, workspaces.length);
  const source = await readFile(new URL('./fixtures/svg/panel.svg', import.meta.url));
  const url = new URL('https://vector-dusk.example/index.html');
  url.hash = new URLSearchParams({
    v: '1',
    name: 'panel.svg',
    encoding: 'gzip',
    data: gzipSync(source).toString('base64url'),
  });
  assert.equal(checkSvgLink(`Open [panel](${url.href}).`), true);
  assert.equal(checkSvgLink(url.href.replace('panel.svg', 'wrong.svg')), false);
  const wrongSource = new URL(url);
  const wrongParams = new URLSearchParams(wrongSource.hash.slice(1));
  wrongParams.set('data', gzipSync('invented artwork').toString('base64url'));
  wrongSource.hash = wrongParams.toString();
  assert.equal(checkSvgLink(wrongSource.href), false);
  assert.equal(checkSvgLink('No link generated.'), false);
  assert.equal(
    checkSvgLink(
      'https://vector-dusk.example/index.html#v=1&name=panel.svg&encoding=gzip&data=invalid',
    ),
    false,
  );
  const android = await readFile(
    new URL('./fixtures/android/app/src/main/res/drawable/panel.xml', import.meta.url),
    'utf8',
  );
  const colors = await readFile(
    new URL('./fixtures/android/app/src/main/res/values/colors.xml', import.meta.url),
    'utf8',
  );
  const androidLink = (xml) => {
    const link = new URL('https://vector-dusk.example/index.html');
    link.hash = new URLSearchParams({
      v: '1',
      name: 'panel.xml',
      encoding: 'gzip',
      data: gzipSync(xml).toString('base64url'),
    });
    return link.href;
  };
  const resolved = android.replace('@color/panel_tone', '#80335577');
  assert.equal(checkAndroidLink(androidLink(resolved)), true);
  assert.equal(checkAndroidLink(androidLink(resolved.replace(/\n\s*/g, ' '))), true);
  assert.equal(
    checkAndroidLink(
      androidLink(
        resolved.replace(
          'android:width="24dp"\n    android:height="24dp"',
          'android:height="24dp"\n    android:width="24dp"',
        ),
      ),
    ),
    true,
  );
  assert.equal(checkAndroidLink(`${androidLink(android)}\n\`\`\`xml\n${colors}\`\`\``), true);
  const resourceFile = path.join(workspaces[1], 'app/src/main/res/values/colors.xml');
  const localHandoff = `${androidLink(android)}\n[colors.xml](${resourceFile})`;
  assert.equal(checkAndroidLink(localHandoff), true);
  assert.equal(
    checkAndroidLink(`${androidLink(android)}\n[colors.xml](${pathToFileURL(resourceFile)})`),
    true,
  );
  assert.equal(checkAndroidLink(`${androidLink(android)}\n[colors.xml](<${resourceFile}>)`), true);
  await writeFile(resourceFile, colors.replace('#80335577', '#FF335577'));
  assert.equal(checkAndroidLink(localHandoff), false);
  await unlink(resourceFile);
  assert.equal(checkAndroidLink(localHandoff), false);
  await symlink(
    fileURLToPath(
      new URL('./fixtures/android/app/src/main/res/values/colors.xml', import.meta.url),
    ),
    resourceFile,
  );
  assert.equal(checkAndroidLink(localHandoff), false);
  await unlink(resourceFile);
  await writeFile(resourceFile, colors);
  assert.equal(checkAndroidLink(androidLink(android)), false);
  assert.equal(
    checkAndroidLink(
      `${androidLink(android)}\n${androidLink(colors).replace('name=panel.xml', 'name=colors.xml')}`,
    ),
    false,
  );
  assert.equal(
    checkAndroidLink(`${androidLink(android)}\n${colors.replace('#80335577', '#FF335577')}`),
    false,
  );
  for (const changed of [
    resolved.replace('#80335577', '#FF335577'),
    resolved.replace('fillAlpha="0.6"', 'fillAlpha="1"'),
    resolved.replace('android:fillAlpha="0.6"', ''),
    resolved.replace('M2,3H22V21H2Z', 'M0,0H10V10Z'),
    resolved.replace('viewportWidth="24"', 'viewportWidth="48"'),
    resolved.replace('</vector>', ''),
  ])
    assert.equal(checkAndroidLink(androidLink(changed)), false);
  assert.equal(
    checkAndroidLink('I will preserve geometry and alpha and import colors.xml.'),
    false,
  );
  const workflow = await prompt({
    vars: { fixture: 'svg', workflow_step: 1, scenario: 'Prepare.' },
  });
  workspaces.push(workflow.config.working_dir);
  const followup = await prompt({ vars: { workflow_step: 2, scenario: 'Still editing.' } });
  assert.equal(followup.config.working_dir, workflow.config.working_dir);
  assert.equal(followup.prompt, 'Still editing.');
  const turn = (step, id = 'test-thread') => ({
    vars: { fixture: 'svg', workflow_step: step },
    providerResponse: { sessionId: id },
  });
  assert.equal(checkWorkflow(url.href, turn(1)).pass, true);
  assert.equal(checkWorkflow('Waiting.', turn(2, 'different-thread')).pass, false);
  assert.equal(checkWorkflow('Waiting.', turn(2)).pass, true);
  assert.equal(checkWorkflow('Out of order.', turn(4)).pass, false);
  assert.equal(checkWorkflow('Please provide the finalized export.', turn(3)).pass, true);
  const edited = source.toString().replace('#335577', '#112233');
  assert.equal(checkWorkflow(edited, turn(4)).pass, true);
  assert.equal(checkWorkflow(url.href, turn(1)).pass, true);
  assert.equal(checkWorkflow('Waiting.', turn(2)).pass, true);
  assert.equal(checkWorkflow('Please provide the finalized export.', turn(3)).pass, true);
  assert.equal(checkWorkflow(source.toString(), turn(4)).pass, false);
  assert.equal(checkWorkflow(url.href, turn(1)).pass, true);
  await writeFile(path.join(workflow.config.working_dir, 'panel.svg'), edited);
  assert.equal(checkWorkflow('Waiting.', turn(2)).pass, false);
  await writeFile(path.join(workflow.config.working_dir, 'panel.svg'), source);
  assert.equal(checkWorkflow('Waiting.', { vars: { workflow_step: 2 } }).pass, false);
  console.log(
    'Fixture setup, artifact checks, workflow isolation and thread continuity checks passed.',
  );
} finally {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
}
