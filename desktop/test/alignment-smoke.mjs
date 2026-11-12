import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiProviders } from '../core/api-providers.mjs';

export async function verifyAlignment({win, settingsWin, root, snapshot, readerWindow, configure, solve, seed, requestDeadline, deferCredential}) {
  const out = path.join(root, 'test-output', 'macos-alignment');
  await fs.mkdir(out, { recursive: true });
  const run = (window, code) => window.webContents.executeJavaScript(code);
  const call = (window, action, payload) => run(window, `window.nspi.call(${JSON.stringify(action)}, ${JSON.stringify(payload)})`);
  const wait = async predicate => {
    const deadline = Date.now() + 4000;
    while (!await predicate()) { if (Date.now() > deadline) throw new Error('Alignment state timed out'); await new Promise(r => setTimeout(r, 20)); }
  };
  await wait(() => run(settingsWin, `!!document.querySelector('.service-options [data-value="official"]')`));
  await run(settingsWin, `document.querySelector('.service-options [data-value="official"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  await wait(() => snapshot().settings.channel === 'api');
  assert.equal(snapshot().settings.reasoning, 'low');
  for (const provider of apiProviders) {
    await run(settingsWin, `(() => {const p=document.querySelector('[name="apiProvider"]');p.value=${JSON.stringify(provider.id)};p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(() => snapshot().settings.apiProvider === provider.id);
    assert.equal(snapshot().settings.protocol, provider.protocol);
  }
  await call(settingsWin, 'saveSettings', { apiProvider: 'openai' });
  await wait(() => run(settingsWin, `document.querySelector('[name="apiProvider"]').value==='openai'`));
  for (const language of ['zh', 'ja', 'en']) {
    await call(settingsWin, 'saveSettings', { language });
    await new Promise(r => setTimeout(r, 160));
    assert.equal(await run(settingsWin, `document.querySelectorAll('[name="apiProvider"] option').length`), 10);
    assert.match(await run(settingsWin, `document.querySelector('.version').textContent`), /3\.1 \(30\)/);
    await fs.writeFile(path.join(out, `service-${language}.png`), (await settingsWin.webContents.capturePage()).toPNG());
  }
  await call(settingsWin, 'saveSettings', { language: 'zh' });

  await call(settingsWin, 'saveSettings', { apiKey: 'offline-key-a' });
  assert.equal((await call(settingsWin, 'readProviderKey')).key, 'offline-key-a');
  await call(settingsWin, 'saveSettings', { apiProvider: 'gemini', apiKey: 'offline-key-b' });
  assert.equal((await call(settingsWin, 'readProviderKey')).key, 'offline-key-b');
  await call(settingsWin, 'saveSettings', { apiProvider: 'openai' });
  assert.equal((await call(settingsWin, 'readProviderKey')).key, 'offline-key-a');
  await call(settingsWin, 'saveSettings', { apiKey: '' });
  assert.equal((await call(settingsWin, 'readProviderKey')).key, '');
  await call(settingsWin, 'saveSettings', { apiProvider: 'gemini' });
  assert.equal((await call(settingsWin, 'readProviderKey')).key, 'offline-key-b');

  let requests = [], behavior = 'answer', finalAnswer = 'B. 60 km/h';
  const encoder = new TextEncoder();
  const event = v => `data: ${typeof v === 'string' ? v : JSON.stringify(v)}\n\n`;
  await configure(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (behavior === 'error') return new Response('{"error":{"message":"fixture failure"}}', {status:503,headers:{'content-type':'application/json'}});
    if (behavior === 'wait') return new Response(new ReadableStream({start(controller) {
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), {once:true});
    }}), {headers:{'content-type':'text/event-stream'}});
    const text = behavior === 'explain' ? 'Distance / time gives 60 km/h.' : 'FINAL: ' + finalAnswer;
    return new Response(new ReadableStream({start(controller) {
      controller.enqueue(encoder.encode(event({choices:[{delta:{content:text}}]}) + event({choices:[{finish_reason:'stop'}]}) + event('[DONE]'))); controller.close();
    }}), {headers:{'content-type':'text/event-stream'}});
  });
  await solve();
  assert.equal(snapshot().answer, 'B. 60 km/h'); assert.equal(snapshot().canExplain, true);
  await call(win, 'fullAnswer');
  await wait(() => readerWindow() && run(readerWindow(), `!!document.querySelector('.reader-answer')`));
  const firstReader = readerWindow();
  await wait(() => firstReader.getContentSize()[1] < 720);
  assert.equal(await run(firstReader, `document.querySelectorAll('.reader-images img').length`), 1);
  await fs.writeFile(path.join(out, 'full-answer.png'), (await firstReader.webContents.capturePage()).toPNG());
  const originalID = snapshot().answerID;
  behavior = 'wait';
  const pending = call(firstReader, 'readerExplain');
  await wait(() => requests.length === 2);
  assert.match(requests[1].messages[0].content, /Explain the answer using only/);
  assert.match(requests[1].messages[1].content[0].text, /Original answer: B\. 60 km\/h/);
  assert.deepEqual(requests[1].messages[1].content[1], requests[0].messages[1].content[1]);
  await call(win, 'explain'); assert.equal(requests.length, 2);
  const presentationChange = await call(settingsWin, 'saveSettings', { answerSize: 17, autoCap: 5 });
  assert.equal(presentationChange.ok, true); assert.equal(snapshot().status, 'running');
  await call(win, 'cancel'); await pending;
  assert.equal(snapshot().status, 'done'); assert.equal(snapshot().answer, 'B. 60 km/h');
  assert.equal(snapshot().answerID, originalID); assert.equal(snapshot().canExplain, false);
  await call(win, 'explain'); assert.equal(requests.length, 2);

  behavior = 'answer'; finalAnswer = 'C. 90 km/h'; seed(); await solve();
  assert.notEqual(snapshot().answerID, originalID);
  const frozen = await call(firstReader, 'state');
  assert.equal(frozen.reader.answer, 'B. 60 km/h'); assert.equal(frozen.reader.canExplain, false);
  await call(firstReader, 'readerExplain'); assert.equal(requests.length, 3);
  await fs.writeFile(path.join(out, 'previous-question.png'), (await firstReader.webContents.capturePage()).toPNG());
  await call(win, 'fullAnswer');
  await wait(() => readerWindow() && readerWindow() !== firstReader && run(readerWindow(), `!!document.querySelector('.reader-answer')`));
  behavior = 'explain'; await call(readerWindow(), 'readerExplain');
  assert.equal(snapshot().answer, 'C. 90 km/h');
  assert.equal(snapshot().explanation, 'Distance / time gives 60 km/h.');
  assert.equal((await call(readerWindow(), 'state')).reader.detail, snapshot().explanation);
  await fs.writeFile(path.join(out, 'explanation.png'), (await readerWindow().webContents.capturePage()).toPNG());
  // Fail the next explanation, preserving its answer and refusing implicit retries.
  behavior = 'answer'; seed(); await solve(); behavior = 'error'; await call(win, 'explain');
  assert.equal(snapshot().status, 'done'); assert.equal(snapshot().answer, 'C. 90 km/h');
  assert.equal(snapshot().explanationFailed, true); assert.equal(snapshot().canExplain, false);
  const count = requests.length; await call(win, 'explain'); assert.equal(requests.length, count);
  behavior = 'wait'; seed();
  const live = solve(); await wait(() => snapshot().status === 'running');
  await call(win, 'readHistory', originalID);
  await wait(() => readerWindow() && run(readerWindow(), `!!document.querySelector('.reader-answer')`));
  assert.equal(snapshot().status, 'running', 'history must not cancel a live request');
  assert.equal((await call(readerWindow(), 'state')).reader.answer, 'B. 60 km/h');
  await call(win, 'cancel'); await live;

  // Cancellation during credential lookup must not replace the next run's owner.
  const releaseKey = deferCredential(); behavior = 'answer'; seed();
  const stale = solve(); await wait(() => snapshot().status === 'running');
  await new Promise(r => setTimeout(r, 20));
  await call(win, 'cancel'); seed(); await solve();
  const newID = snapshot().answerID;
  releaseKey(); await stale;
  assert.equal(snapshot().answerID, newID); assert.equal(snapshot().canExplain, true);
  assert.equal(snapshot().failureKind, null);
  // Exercise the real watchdog with a short fixture deadline, then a new request.
  requestDeadline(40); behavior = 'wait'; seed(); await solve();
  assert.equal(snapshot().status, 'error'); assert.equal(snapshot().failureKind, 'service'); assert.match(snapshot().message, /超时/);
  requestDeadline(110000); behavior = 'answer'; seed(); await solve();
  assert.equal(snapshot().status, 'done'); assert.equal(snapshot().canExplain, true);
  const concurrentSettings = await Promise.all([
    call(settingsWin, 'saveSettings', { answerSize: 15 }),
    call(settingsWin, 'saveSettings', { collapseDelay: 7 }),
  ]);
  assert.ok(concurrentSettings.every(x => x.ok));
  assert.equal(snapshot().settings.answerSize, 15); assert.equal(snapshot().settings.collapseDelay, 7);

  // Sample the painted renderer, including an interrupted close. Nominal curves
  // are shared with AppKit; wall-clock frames are host/compositor evidence only.
  await call(win, 'expand', true);
  await new Promise(r => setTimeout(r, 400));
  const motion = [];
  for (const reverse of [false, true]) {
    if (reverse) { await call(win, 'expand', true); await new Promise(r => setTimeout(r, 400)); }
    motion.push(await run(win, `(async () => {
      const samples=[], start=performance.now(); let reversed=false;
      await window.nspi.call('expand',false);
      return await new Promise(resolve => {
        function frame(now) {
          const slab=document.querySelector('.slab'), content=document.querySelector('.slab-content');
          const rect=slab.getBoundingClientRect();
          samples.push({ms:now-start,x:rect.x,y:rect.y,width:rect.width,height:rect.height,opacity:Number(getComputedStyle(content).opacity)});
          if (${reverse} && !reversed && now-start>=100) {reversed=true;window.nspi.call('expand',true);}
          if(now-start<650) requestAnimationFrame(frame); else resolve(samples);
        }
        requestAnimationFrame(frame);
      });
    })()`));
    const frames = motion.at(-1);
    assert.ok(frames.length > 5);
    assert.ok(frames.every(f => f.opacity >= 0 && f.opacity <= 1 && f.width > 0));
    assert.ok(Math.abs(frames.at(-1).width - (reverse ? 600 : 260)) < 1);
    assert.ok(Math.abs(frames.at(-1).opacity - (reverse ? 1 : 0)) < .01);
  }
  await fs.writeFile(path.join(out, 'morph-frames.json'), JSON.stringify({host:process.platform,nominalDurationMs:320,close:motion[0],interruptedClose:motion[1]},null,2));
  const environment = await run(settingsWin, `({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,language:document.documentElement.lang})`);
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({host:process.platform,arch:process.arch,electron:process.versions.electron,windowsRealDevice:false,environment,requests:requests.length,checks:['provider keyboard navigation','10 providers, three languages','native version display','separate reading snapshot','original image/answer explanation binding','duplicate explanation admission','live presentation edits','cancel preserves answer','stale reader cannot explain new question','successful explanation','failure preserves answer, no retry','history preserves live request','credential-read cancellation isolation','watchdog recovery','serialized settings persistence','per-provider key refill and deletion','painted close and interrupted reopen frames']},null,2));
}
