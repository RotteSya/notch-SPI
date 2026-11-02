// Machine-readable companion to verify.sh's existing logs and summary.tsv. No credentials.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceSnapshot(directory = root) {
  const git = args => execFileSync('git', args, {cwd:directory,encoding:'utf8'});
  const names = [...new Set(git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean))].sort();
  const files = names.map(name => {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) return [name, 'deleted'];
    const stat = fs.lstatSync(file);
    return [name, stat.isSymbolicLink() ? 'symlink' : (stat.mode & 0o111 ? 'executable' : 'file'),
      digest(stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file))];
  });
  return {commit:git(['rev-parse','HEAD']).trim(), source_sha256:digest(JSON.stringify(files)),
    dirty:Boolean(git(['status','--porcelain','--untracked-files=all']).trim()), file_count:files.length};
}

export function testSummary(log) {
  const last = expression => [...log.matchAll(expression)].at(-1);
  const node = last(/(?:ℹ|#) tests (\d+)/g);
  const swift = last(/Executed (\d+) tests?, (?:with (\d+) tests? skipped and |with )(\d+) failures?/g);
  const tests = {total:null, passed:null, failed:null, skipped:null};
  if (node) {
    tests.total=Number(node[1]);
    for (const [key,label] of [['passed','pass'],['failed','fail'],['skipped','skipped']]) {
      const value=last(new RegExp(`(?:ℹ|#) ${label} (\\d+)`,'g'));
      if (value) tests[key]=Number(value[1]);
    }
  } else if (swift) {
    tests.total=Number(swift[1]); tests.skipped=Number(swift[2] ?? 0); tests.failed=Number(swift[3]);
    tests.passed=tests.total-tests.skipped-tests.failed;
  }
  const skip_reasons=[...new Set([...log.matchAll(/Test skipped - ([^\n]+)|# SKIP(?: ([^\n]+))?/g)].map(m=>m[1]??m[2]??'conditional skip'))];
  return {tests,skip_reasons};
}

function write(file, body) { fs.writeFileSync(file, JSON.stringify(body,null,2)+'\n'); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action,out,...args]=process.argv.slice(2);
  const file=path.join(out,'results.json');
  if(action==='init') write(file,{schema_version:1,started_at:new Date().toISOString(),mode:args[0],source:sourceSnapshot(),steps:[]});
  else if(action==='step') {
    const [name,status,duration,code,reason,log,...command]=args;
    const report=JSON.parse(fs.readFileSync(file));
    const required=!['hardware','signing'].includes(name) && !(name==='postgres' && status==='skipped');
    const result={name,status,required,exit_code:code===''?null:Number(code),duration_ms:Number(duration),
      command,log_path:path.relative(root,log),reason,...testSummary(fs.readFileSync(log,'utf8'))};
    report.steps.push(result); write(file,report);
  } else if(action==='finish') {
    const report=JSON.parse(fs.readFileSync(file)); report.finished_at=new Date().toISOString();
    report.source_after=sourceSnapshot(); report.source_consistent=report.source.source_sha256===report.source_after.source_sha256;
    report.automation_passed=report.source_consistent && report.steps.every(step=>!step.required || step.status==='passed');
    write(file,report); if(!report.automation_passed) process.exitCode=1;
  } else throw new Error('Expected init, step or finish');
}
