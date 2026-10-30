import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { screen } from 'electron';
export async function verifyFeedback({win,root,setFixture,getFeedback,setFeedbackSaveDialog}) {
 const out=path.join(root,'test-output','feedback-parity');await fs.mkdir(out,{recursive:true});
 const run=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await pause(30);}throw new Error('Feedback UI condition timed out');};
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await setFixture({mode:'tutor',status:'done',count:4,settings:{channel:'api'}});await pause(450);
 await click('[data-action=menu]');await pause(200);
 assert.equal(await run('!!document.querySelector("[data-action=exportFeedback]")'),true);
 // Hover opens a separate side menu, not inline rows. Both surfaces stay within the host.
 await run('document.querySelector("[data-action=menuBranch][data-value=target]").dispatchEvent(new PointerEvent("pointerover",{bubbles:true}))');await pause(250);
 const geometry=await run(`(()=>{const a=document.querySelector('.notch-menu').getBoundingClientRect(),b=document.querySelector('.notch-submenu').getBoundingClientRect();return {side:b.right<=a.left+1||b.left>=a.right-1,bounds:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight};})()`);
 assert.equal(geometry.side,true);assert.equal(geometry.bounds,true);
 await fs.writeFile(path.join(out,'submenu-target.png'),(await win.webContents.capturePage()).toPNG());
 await run('document.querySelector("[data-action=menuBranch][data-value=target]").focus();document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
 assert.equal(await run('!!document.activeElement.closest(".notch-submenu")'),true);
 await run('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
 assert.equal(await run('document.activeElement.dataset.value'),'target');
 assert.equal(await run('!!document.querySelector(".notch-submenu")'),false);
 await click('[data-action=exportFeedback]');
 await wait(()=>getFeedback()&&!getFeedback().webContents.isLoading());
 let review=getFeedback(),exec=code=>review.webContents.executeJavaScript(code);
 await wait(()=>exec('!!document.querySelector(".feedback-save")'));
 assert.equal(await exec('document.querySelector(".feedback-save").disabled'),true);
 assert.equal(await exec('document.querySelectorAll("[name=asset]:checked").length'),4);
 const layout=await exec(`(()=>{const scroll=document.querySelector('.feedback-scroll'),permission=document.querySelector('.feedback-permission');return {height:innerHeight,scroll:scroll.clientHeight,bottom:permission.getBoundingClientRect().bottom,controls:[...document.querySelectorAll('button,input,select,textarea')].map(x=>({tag:x.tagName,height:x.getBoundingClientRect().height}))};})()`);
 await fs.writeFile(path.join(out,'layout.json'),JSON.stringify({layout,window:review.getBounds(),content:review.getContentBounds(),displays:screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea})),cursor:screen.getCursorScreenPoint()},null,2));
 assert.equal(layout.height,Math.min(685,screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea.height),'feedback uses content dimensions within the current work area');
 if(layout.height>=685)assert.ok(layout.scroll>=416,'all consent controls fit on a normal-height screen');
 assert.ok(layout.controls.every(x=>x.height>0));
 await fs.writeFile(path.join(out,'layout.json'),JSON.stringify({layout,window:review.getBounds(),content:review.getContentBounds()},null,2));
 await fs.writeFile(path.join(out,'initial.png'),(await review.webContents.capturePage()).toPNG());
 await exec('document.querySelector("[name=permission]").click()');
 assert.equal(await exec('document.querySelector(".feedback-save").disabled'),false);
 await exec('document.querySelectorAll("[data-image]")[1].click()');
 assert.equal(await exec('document.querySelector("[name=permission]").checked'),true,'previewing another image does not change authorization scope');
 await exec('document.querySelector("[name=asset]").click()');
 assert.equal(await exec('document.querySelector(".feedback-save").disabled'),true);
 for(const selector of ['.feedback-standard','.feedback-purpose']){
  await exec('document.querySelector("[name=permission]").click()');
  await exec(`(()=>{const x=document.querySelector('${selector}');x.value='${selector==='.feedback-standard'?'B. 60 km/h':'quality_evaluation'}';x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await exec('document.querySelector("[name=permission]").checked'),false);
 }
 // An asynchronous next answer must not replace the content already reviewed.
 await setFixture({mode:'tutor',status:'done',count:1,answer:'NEXT ANSWER'});await pause(100);
 assert.equal(await exec('document.querySelector("#feedback-answer").value'),'B. 60 km/h');
 assert.equal(await exec('document.querySelectorAll("[name=asset]:checked").length'),3);
 // Untrusted siblings cannot save or bypass the consent dialog.
 assert.match(await run('window.nspi.call("feedbackSave",{}).then(()=>"unexpectedly allowed",e=>e.message)'),/review window/);
 const destination=path.join(out,'feedback.json');let saveOptions;
 setFeedbackSaveDialog(async options=>{saveOptions=options;return {canceled:false,filePath:destination};});
 await exec('setTimeout(()=>{document.querySelector("[name=permission]").click();document.querySelector(".feedback-save").click();},0);void 0');
 await wait(()=>!getFeedback());
 console.log('FEEDBACK_SAVED');
 const manifest=JSON.parse(await fs.readFile(destination,'utf8'));
 assert.equal(manifest.assets.length,3);assert.deepEqual(manifest.assets.map(x=>x.role),['reference','reference','question']);
 assert.equal(manifest.answer,'B. 60 km/h');assert.equal(manifest.standard_answer,'B. 60 km/h');assert.equal(manifest.purpose,'quality_evaluation');
 assert.equal(manifest.authorization.rights_confirmed,true);assert.match(saveOptions.defaultPath,/^notchspi-feedback-.*\.json$/);assert.match(saveOptions.message,/不会自动发送/);
 for(const asset of manifest.assets) assert.equal((await fs.stat(path.join(out,asset.file))).size,asset.byteCount);
 // Save-panel cancellation returns to the notch without creating a package.
 await click('[data-action=menu]');await pause(200);await click('[data-action=exportFeedback]');
 await wait(()=>getFeedback()&&!getFeedback().webContents.isLoading());review=getFeedback();
 await wait(()=>exec('!!document.querySelector(".feedback-save")'));
 setFeedbackSaveDialog(async()=>({canceled:true}));
 await exec('setTimeout(()=>{document.querySelector("[name=permission]").click();document.querySelector(".feedback-save").click();},0);void 0');await wait(()=>!getFeedback());
 console.log('FEEDBACK_SAVE_CANCELED');
 // Preview cancellation never even opens the Save dialog.
 let called=false;setFeedbackSaveDialog(async()=>{called=true;return {canceled:true};});
 await click('[data-action=menu]');await pause(200);await click('[data-action=exportFeedback]');
 await wait(()=>getFeedback()&&!getFeedback().webContents.isLoading());review=getFeedback();await wait(()=>exec('!!document.querySelector(".feedback-save")'));
 await exec('setTimeout(()=>document.querySelector(".feedback-cancel").click(),0);void 0');await wait(()=>!getFeedback());assert.equal(called,false);
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({host:process.platform,consentReset:true,selectedAssets:3,previewCancel:true,saveCancel:true,sideSubmenu:true,keyboardReturn:true,windowsHardware:'not-run'},null,2));
}
