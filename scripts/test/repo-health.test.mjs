// Direct checks for the Git-aware document scanner. Fixtures are temporary repos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IMMUTABLE_EVIDENCE,
  checkDocumentLinks,
  checkDelivery,
  checkHistoricalArchives,
  checkGovernance,
  checkGuideMap,
  checkPortableDocs,
  checkTrackedSymlinks,
  forbiddenTrackedReason,
  governedPaths,
  indexedPaths,
  isImmutableEvidence,
} from '../lib/repo-health-lib.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

const temporaryRoots = [];
after(() => { for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-health-'));
  temporaryRoots.push(root);
  git(root, ['init', '-q']);
  return root;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function commit(root) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=repo-health@example.com', '-c', 'user.name=repo-health', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture']);
}

test('ignored evidence is not scanned, but current docs cannot depend on it', () => {
  const root = fixture();
  write(root, '.gitignore', 'output/\n.release-evidence/\n');
  write(root, 'docs/ok.md', 'See [note](../output/note.md).\n');
  write(root, 'output/note.md', 'kept locally\n');
  write(root, 'output/bad.md', 'Broken [gone](missing.md).\n');
  write(root, '.release-evidence/log.md', 'Also [gone](nope.md).\n');
  commit(root);
  const governed = governedPaths(root);
  assert.equal(governed.includes('output/bad.md'), false);
  assert.equal(governed.includes('.release-evidence/log.md'), false);
  assert.equal(governed.includes('docs/ok.md'), true);
  assert.match(checkDocumentLinks(root, governed).join("\n"), /relative link is outside the delivery file set/);
});

test('a broken link in a tracked document fails', () => {
  const root = fixture();
  write(root, 'docs/bad.md', 'See [missing](missing.md).\n');
  commit(root);
  const errors = checkDocumentLinks(root, governedPaths(root));
  assert.equal(errors.some((line) => line.includes('docs/bad.md') && line.includes('broken relative link')), true);
});

test('a broken link in an unignored new document fails', () => {
  const root = fixture();
  write(root, 'README.md', '# fixture\n');
  commit(root);
  write(root, 'docs/new.md', 'See [missing](missing.md).\n');
  const governed = governedPaths(root);
  assert.equal(governed.includes('docs/new.md'), true);
  const errors = checkDocumentLinks(root, governed);
  assert.equal(errors.some((line) => line.startsWith('docs/new.md')), true);
});

test('a link that leaves the repository fails', () => {
  const root = fixture();
  write(root, 'docs/out.md', 'See [up](../../outside.txt) and [abs](/etc/passwd).\n');
  commit(root);
  const errors = checkDocumentLinks(root, governedPaths(root));
  assert.equal(errors.filter((line) => line.includes('link escapes repo')).length, 2);
});

test('a URL-encoded escape and a heading anchor are classified separately', () => {
  const root = fixture();
  write(root, 'docs/here.md', '# Here\n## Section\n');
  write(root, 'docs/links.md', 'Stay [here](here.md#section) and leave [out](%2e%2e/%2e%2e/secret).\n');
  write(root, 'docs/spaced.md', 'See [space](<my file.md>).\n');
  write(root, 'docs/my file.md', 'present\n');
  commit(root);
  const errors = checkDocumentLinks(root, governedPaths(root));
  assert.equal(errors.some((line) => line.includes('here.md#section')), false);
  assert.equal(errors.some((line) => line.includes('my file.md')), false);
  assert.equal(errors.some((line) => line.includes('link escapes repo') && line.includes('%2e%2e')), true);
});

test('a symlink that leaves the repository fails', () => {
  const root = fixture();
  const outside = path.join(os.tmpdir(), `repo-health-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, 'outside\n');
  write(root, 'docs/note.md', 'See [away](away.txt).\n');
  fs.symlinkSync(outside, path.join(root, 'docs/away.txt'));
  fs.symlinkSync(outside, path.join(root, 'leak.txt'));
  commit(root);
  const governed = governedPaths(root);
  const links = checkDocumentLinks(root, governed);
  const symlinks = checkTrackedSymlinks(root, governed);
  assert.equal(links.some((line) => line.includes('link symlink leaves repo')), true);
  assert.equal(symlinks.some((line) => line === 'leak.txt: symlink leaves repo'), true);
  fs.rmSync(outside, { force: true });
});

test('tracked databases, credentials, and generated trees are rejected', () => {
  for (const file of [
    'server/data/app.db',
    'server/data/app.db-wal',
    'server/data/app.db-shm',
    'server/.env',
    '.build/debug/app',
    'dist/NotchSPI.app/Contents/Info.plist',
    'dist-qa/NotchSPI.app',
    'server/node_modules/fastify/package.json',
    '.eval-results/run.json',
  ]) {
    assert.match(forbiddenTrackedReason(file) ?? '', /generated or secret path is tracked/);
  }
  assert.equal(forbiddenTrackedReason('server/.env.example'), null);
  assert.equal(forbiddenTrackedReason('docs/client-behavior.md'), null);
});

test('a tracked ignored database remains visible to the index scan', () => {
  const root = fixture();
  write(root, 'local.db', 'sqlite\n');
  commit(root);
  write(root, '.gitignore', '*.db\n');
  commit(root);
  assert.equal(indexedPaths(root).includes('local.db'), true);
  assert.equal(governedPaths(root).includes('local.db'), true);
});

test('the seventeen evidence files are exempt and a new sibling is not', () => {
  assert.equal(IMMUTABLE_EVIDENCE.length, 17);
  const root = fixture();
  const sample = IMMUTABLE_EVIDENCE[2];
  write(root, sample, 'Signed summary. Broken [x](missing.md) and /Users/example/path.\n');
  write(root, 'objective-eval-output/new-sibling.md', 'Broken [x](missing.md) and /Users/example/path.\n');
  commit(root);
  for (const rel of IMMUTABLE_EVIDENCE) assert.equal(isImmutableEvidence(rel), true);
  assert.equal(isImmutableEvidence('objective-eval-output/new-sibling.md'), false);
  const governed = governedPaths(root);
  const links = checkDocumentLinks(root, governed);
  const portable = checkPortableDocs(root, governed);
  assert.equal(links.some((line) => line.startsWith(sample)), false);
  assert.equal(portable.some((line) => line.startsWith(sample)), false);
  assert.equal(links.some((line) => line.startsWith('objective-eval-output/new-sibling.md')), true);
  assert.equal(portable.some((line) => line.startsWith('objective-eval-output/new-sibling.md')), true);
});

test('the live evidence set matches the allowlist exactly', () => {
  const live = execFileSync('git', ['ls-files', 'objective-eval-output'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
  assert.deepEqual(live, [...IMMUTABLE_EVIDENCE].sort());
});

test('README startup copies, long pointers, and an oversized handover fail', () => {
  const root = fixture();
  write(root, 'README.md', 'Start with `./scripts/bootstrap.sh --run`.\n');
  write(root, 'HANDOVER.md', `${'# 标题\n'.repeat(201)}`);
  write(root, 'AGENTS.md', 'one\ntwo\nthree\nfour\nfive\nsix\n');
  const errors = checkGovernance(root);
  assert.equal(errors.some((line) => line.includes('README.md must link to HANDOVER.md')), true);
  assert.equal(errors.some((line) => line.includes('must not copy startup commands')), true);
  assert.equal(errors.some((line) => line.includes('HANDOVER.md is 201 lines')), true);
  assert.equal(errors.some((line) => line.includes('AGENTS.md must stay a short pointer')), true);
  assert.equal(errors.some((line) => line.includes('AGENTS.md must point at HANDOVER.md')), true);
});

test('a handover over 20 KiB or 1200 opening Han characters fails', () => {
  const root = fixture();
  write(root, 'README.md', 'Read [HANDOVER.md](HANDOVER.md).\n');
  write(root, 'HANDOVER.md', `${'测'.repeat(1201)}\n## 后文\n`);
  let errors = checkGovernance(root);
  assert.equal(errors.some((line) => line.includes('1201 Han characters')), true);
  write(root, 'HANDOVER.md', `# 交接\n\n${'x'.repeat(20481)}\n## 后文\n`);
  errors = checkGovernance(root);
  assert.equal(errors.some((line) => /HANDOVER.md is \d+ bytes/.test(line)), true);
});

test('a compact handover and pointer pass', () => {
  const root = fixture();
  write(root, 'README.md', '工程入口是 [HANDOVER.md](HANDOVER.md)。\n');
  write(root, 'HANDOVER.md', '# 交接\n\n摘要。\n\n## 阅读规则\n\nrole: engineering\n');
  write(root, 'AGENTS.md', 'Read HANDOVER.md.\n');
  write(root, 'CLAUDE.md', 'Read HANDOVER.md.\n');
  assert.deepEqual(checkGovernance(root), []);
});


test('delivery rejects untracked dependencies and unstaged edits, then accepts the complete index', () => {
  const root = fixture();
  write(root, 'README.md', '# Entry\n');
  commit(root);
  write(root, 'README.md', '[Required contract](contract.md)\n');
  write(root, 'contract.md', 'Contract\n');
  assert.deepEqual(checkDocumentLinks(root, governedPaths(root)), []);
  assert.match(checkDocumentLinks(root, indexedPaths(root)).join('\n'), /outside the delivery file set/);
  assert.match(checkDelivery(root).join('\n'), /untracked file.*contract.md/);
  assert.match(checkDelivery(root).join('\n'), /unstaged change.*README.md/);
  git(root, ['add', '-A']);
  assert.deepEqual(checkDelivery(root), []);
  assert.deepEqual(checkDocumentLinks(root, indexedPaths(root)), []);
});

test('historical archives fail if their bytes are changed or missing', () => {
  const root = fixture();
  const archive = 'docs/history/2026-retired.tar.gz';
  write(root, archive, 'original historical bytes');
  const digest = createHash('sha256').update('original historical bytes').digest('hex');
  write(root, 'docs/history/2026-retired.json', JSON.stringify({ archive: '2026-retired.tar.gz', sha256: digest }));
  assert.deepEqual(checkHistoricalArchives(root), []);
  write(root, archive, 'modified');
  assert.match(checkHistoricalArchives(root).join('\n'), /SHA-256 mismatch/);
  fs.unlinkSync(path.join(root, archive));
  assert.equal(checkHistoricalArchives(root).length, 1);
});

test('heading anchors support Unicode, duplicates and same-document links', () => {
  const root=fixture();
  write(root,'docs/guide.md','# 指南\n## 重复标题\n## 重复标题\n```md\n## 假标题\n```\n[本节](#重复标题-1)\n');
  write(root,'HANDOVER.md','[有效](docs/guide.md#重复标题) [编码](docs/guide.md#%E9%87%8D%E5%A4%8D%E6%A0%87%E9%A2%98-1)\n');
  assert.deepEqual(checkDocumentLinks(root,governedPaths(root)),[]);
  write(root,'HANDOVER.md','[失效](docs/guide.md#重复标题-2) [代码块](docs/guide.md#假标题)\n');
  assert.equal(checkDocumentLinks(root,governedPaths(root)).filter(x=>x.includes('broken heading anchor')).length,2);
});

function guideFixture() {
  const root=fixture();
  write(root,'owner.mjs','// owner\n');
  write(root,'HANDOVER.md','# 入口\n[契约](docs/reference.md)\n');
  write(root,'docs/reference.md','# 契约\n');
  const item=(file,kind)=>({path:file,kind,scope:['governance'],purpose:'fixture',sources:['owner.mjs'],checks:['owner.mjs']});
  const map={schema_version:1,entry:'HANDOVER.md',documents:[item('HANDOVER.md','entry'),item('docs/reference.md','reference')]};
  const save=()=>write(root,'docs/guide-map.json',JSON.stringify(map));save();
  return {root,map,save,item};
}

test('guide map rejects unclassified docs, unreachable references and missing owners',()=>{
  const {root,map,save}=guideFixture();
  assert.deepEqual(checkGuideMap(root,governedPaths(root)),[]);
  write(root,'docs/orphan.md','# 遗漏\n');
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/unclassified Markdown.*orphan/);
  fs.unlinkSync(path.join(root,'docs/orphan.md'));
  write(root,'HANDOVER.md','# 入口\n');
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/unreachable/);
  map.documents[1].sources=['missing.mjs'];save();
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/missing sources target/);
});

test('guide map enforces one entry, portable commands and dated evidence identity',()=>{
  const {root,map,save,item}=guideFixture();
  map.documents[1].kind='entry';save();
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/single entry/);
  map.documents[1].kind='reference';
  write(root,'docs/reference.md','Use `./scripts/bootstrap.sh --run` or `output/local/启动.command`.\n');save();
  let errors=checkGuideMap(root,governedPaths(root)).join('\n');
  assert.match(errors,/startup command belongs/);assert.match(errors,/runnable local output/);
  write(root,'docs/evidence.md','# 历史\n');map.documents.push(item('docs/evidence.md','evidence'));save();
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/missing evidence identity/);
  Object.assign(map.documents.at(-1),{as_of:null,source_commit:null});save();
  assert.equal(checkGuideMap(root,governedPaths(root)).some(x=>x.includes('missing evidence identity')),false);
});

test('archive members are checked against their individual digests',()=>{
  const root=fixture();write(root,'old.md','original\n');
  fs.mkdirSync(path.join(root,'docs/history'),{recursive:true});
  execFileSync('tar',['-czf',path.join(root,'docs/history/unit-retired.tar.gz'),'-C',root,'old.md']);
  const bytes=fs.readFileSync(path.join(root,'docs/history/unit-retired.tar.gz'));
  write(root,'docs/history/unit-retired.json',JSON.stringify({archive:'unit-retired.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex'),files:[{path:'old.md',sha256:'0'.repeat(64)}]}));
  assert.match(checkHistoricalArchives(root).join('\n'),/archive member mismatch/);
});

test('operation dependencies require delivered files or explicit generation/acquisition contracts', () => {
  const {root,map,save}=guideFixture(), item=map.documents[1];
  write(root,'fixture.html','offline material');
  item.required_artifacts=[{kind:'tracked',path:'fixture.html'},
    {kind:'generated',path:'output/candidate/delivery-manifest.json',producer:'owner.mjs',contract:'Run owner.mjs'},
    {kind:'external',path:'output/reference',acquisition_contract:'Ask the reviewer for source-identified references'}];
  item.candidate_identity={source:'delivery-manifest',artifact:'output/candidate/delivery-manifest.json'};save();
  assert.deepEqual(checkGuideMap(root,governedPaths(root)),[]);
  assert.match(checkGuideMap(root,governedPaths(root).filter(f=>f!=='fixture.html')).join('\n'),/required artifact is outside delivery/);
  fs.unlinkSync(path.join(root,'fixture.html'));
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/required artifact is outside delivery/);
  item.required_artifacts[1].producer='missing.mjs';item.required_artifacts[2].acquisition_contract='';save();
  let errors=checkGuideMap(root,governedPaths(root)).join('\n');
  assert.match(errors,/delivered producer and contract/);assert.match(errors,/acquisition contract/);
  item.required_artifacts=[{kind:'tracked',path:'../escape'}];save();
  errors=checkGuideMap(root,governedPaths(root)).join('\n');
  assert.match(errors,/invalid required artifact/);assert.match(errors,/candidate identity/);
  item.required_artifacts=null;save();
  assert.match(checkGuideMap(root,governedPaths(root)).join('\n'),/invalid required_artifacts/);
});

test('each current Windows tracked operation material must belong to delivery', () => {
  const files=governedPaths(REPO);
  const map=JSON.parse(fs.readFileSync(path.join(REPO,'docs/guide-map.json')));
  const item=map.documents.find(item=>item.path==='docs/windows/manual-acceptance.md');
  const materials=item.required_artifacts.filter(a=>a.kind==='tracked');
  assert.ok(materials.length>=2);
  for(const artifact of materials) {
    assert.ok(files.includes(artifact.path));
    assert.ok(checkGuideMap(REPO,files.filter(f=>f!==artifact.path)).some(e=>e.includes(`required artifact is outside delivery: ${artifact.path}`)));
  }
});

test('offline acceptance material switches all scenarios and Escape restores the menu', async () => {
  const {runInNewContext}=await import('node:vm');
  const html=fs.readFileSync(path.join(REPO,'docs/windows/fixtures/practice.html'),'utf8');
  const menu={hidden:false,buttons:[],append(b){this.buttons.push(b);}}, question={hidden:true};
  let keydown;
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document:{
    getElementById:id=>id==='menu'?menu:question,createElement:()=>({}),
    addEventListener:(event,handler)=>{assert.equal(event,'keydown');keydown=handler;}
  }});
  assert.deepEqual(menu.buttons.map(b=>b.textContent),['单题1','单题2','公式题','两图·材料','两图·问题','四图1','四图2','四图3','四图4','人物像1','人物像2','空白页','缺条件题']);
  for(const button of menu.buttons){
    button.onclick();assert.equal(menu.hidden,true);assert.equal(question.hidden,false);
    assert.equal(question.textContent.length===0,button.textContent==='空白页');
    keydown({key:'Escape'});assert.equal(menu.hidden,false);assert.equal(question.hidden,true);
  }
});
