import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyStaticOutput,parseSmokeOutput} from '../verify-vercel-output.mjs';

test('bundle smoke result is distinct from runtime diagnostics', () => {
  const result = {checks:['bundled_handler_health'],paid_model_calls:0};
  const line = 'NSPI_BUNDLE_SMOKE_RESULT ' + JSON.stringify(result);
  assert.deepEqual(parseSmokeOutput('{"requestLifetimeExtension":false}\n'+line+'\n'), result);
  assert.throws(() => parseSmokeOutput('{"requestLifetimeExtension":false}\n'), /exactly one/);
  assert.throws(() => parseSmokeOutput(line+'\n'+line), /exactly one/);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nspi-vercel-static-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await cp(new URL('../../server/public/', import.meta.url), directory, {recursive: true});
  return directory;
}

test('Vercel accepts only the reviewed website media and robots, with identical bytes', async t => {
  assert.deepEqual(await verifyStaticOutput(await fixture(t)), [
    'media/automatic-mode-poster.jpg', 'media/automatic-mode.mp4',
    'media/single-mode-poster.jpg', 'media/single-mode.mp4', 'robots.txt',
  ]);
});

for (const name of ['.env', 'src/config.ts', 'test/api.test.ts', 'media/unreviewed.mp4']) {
  test(`Vercel rejects an extra public file: ${name}`, async t => {
    const directory = await fixture(t), target = join(directory, name);
    await mkdir(join(target, '..'), {recursive: true});
    await writeFile(target, 'must not be public');
    await assert.rejects(verifyStaticOutput(directory), /Unexpected public source, test or asset/);
  });
}

for (const name of ['robots.txt', 'media/single-mode.mp4']) {
  test(`Vercel rejects missing or altered reviewed bytes: ${name}`, async t => {
    const directory = await fixture(t), target = join(directory, name);
    await writeFile(target, 'altered');
    await assert.rejects(verifyStaticOutput(directory), /Static asset differs from reviewed source/);
    await rm(target);
    await assert.rejects(verifyStaticOutput(directory), /Unexpected public source, test or asset/);
  });
}

test('Vercel rejects a symlink even when it points to reviewed source bytes', async t => {
  const directory = await fixture(t), target = join(directory, 'robots.txt');
  await rm(target);
  await symlink(fileURLToPath(new URL('../../server/public/robots.txt', import.meta.url)), target);
  await assert.rejects(verifyStaticOutput(directory), /Use vercel build --standalone/);
});
