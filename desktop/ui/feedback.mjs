const strings = {
 zh:['检查反馈内容与授权','仅导出勾选图片、当前答案和可选标准答案，不会自动发送。授权有效 90 天，收取后仅授权审题成员可访问；到期或撤回时删除收取的材料。外部模型处理需另行同意。本机导出文件由你自行删除。\n支持及撤回：raysyadesu@gmail.com','当前图片预览','切换预览图片','打开原图','参考','题目','将导出的当前答案','可选：标准答案','允许的用途','仅排查本次问题','排查问题并用于质量评测','我有权提供所选材料，并同意所选用途','导出到本机','取消','反馈内容与用途','请先得到一个完整答案。','保存失败，请重试。','反馈已保存：','如需提交，请将 JSON 文件和旁边的材料文件夹一起发送至 raysyadesu@gmail.com。保存不会自动发送。'],
 ja:['内容と利用許諾を確認','選択した画像・現在の回答・任意の正解を本機へ保存し、自動送信はしません。許諾は 90 日間有効で、受領後は許可された審査担当者のみ利用します。期限または撤回時に受領資料を削除します。外部モデルでの処理は別の同意が必要です。本機のファイルは自分で削除してください。\n問い合わせ・撤回：raysyadesu@gmail.com','現在の画像プレビュー','プレビュー画像を選択','元画像を開く','参考','問題','書き出す現在の回答','任意：正解','許可する用途','今回の問題の調査のみ','問題の調査と品質評価','選択資料を提供する権利があり、選んだ用途に同意します','本機へエクスポート','キャンセル','内容と用途','まず完全な回答を取得してください。','保存に失敗しました。','保存しました：','提出する場合は JSON と隣の資料フォルダを一緒に raysyadesu@gmail.com へ送ってください。保存だけでは送信されません。'],
 en:['Review feedback and permission','Exports checked images, the current answer and an optional reference answer locally. Nothing is sent automatically. Permission lasts 90 days; only authorized reviewers may access received material, which is deleted at expiry or withdrawal. External model processing needs separate permission. Delete your local exports yourself.\nSupport and withdrawal: raysyadesu@gmail.com','Current image preview','Choose preview image','Open full image','Reference','Question','Current answer to export','Optional reference answer','Allowed purpose','Investigate this problem only','Investigate and evaluate quality','I may share this material and authorize the selected purpose.','Export locally','Cancel','Feedback content and purpose','Get a complete answer first.',"Couldn't save the feedback package. Try again.",'Feedback saved: ','To submit, send the JSON file together with its adjacent material folder to raysyadesu@gmail.com. Saving does not send anything.']
};
export const feedbackText = language => strings[language] ?? strings.en;
const escape = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current;
export function renderFeedback(root, state, call) {
 const data = state.feedback;
 if (!data || current === data.id) return;
 current = data.id;
 const t = feedbackText(data.language);
 root.innerHTML = `<section class="feedback-dialog" role="dialog" aria-labelledby="feedback-title"><img class="feedback-icon" src="icon.png" alt=""><h1 id="feedback-title">${t[0]}</h1><p class="feedback-info">${t[1]}</p><div class="feedback-scroll" aria-label="${t[15]}"><form class="feedback-content"><img class="feedback-image" alt="${t[2]}" src="${data.assets[0]?.url ?? ''}"><div class="feedback-selector" role="group" aria-label="${t[3]}">${data.assets.map((a,i)=>`<button type="button" data-image="${i}" aria-pressed="${i===0}">${i+1}</button>`).join('')}</div><button type="button" class="feedback-full">${t[4]}</button><div class="feedback-assets">${data.assets.map((a,i)=>`<label><input type="checkbox" name="asset" value="${escape(a.id)}" checked>${i+1} · ${a.role==='question'?t[6]:t[5]}</label>`).join('')}</div><label class="feedback-answer-label" for="feedback-answer">${t[7]}</label><textarea id="feedback-answer" readonly>${escape(data.answer)}</textarea><input class="feedback-standard" aria-label="${t[8]}" placeholder="${t[8]}" maxlength="16384"><select class="feedback-purpose" aria-label="${t[9]}"><option value="support_review">${t[10]}</option><option value="quality_evaluation">${t[11]}</option></select><label class="feedback-permission"><input type="checkbox" name="permission">${t[12]}</label></form></div><div class="feedback-buttons"><button class="feedback-cancel">${t[14]}</button><button class="feedback-save" disabled>${t[13]}</button></div></section>`;
 const permission = root.querySelector('[name=permission]'), save = root.querySelector('.feedback-save');
 let selected = 0, busy = false;
 root.querySelector('form').onsubmit = e => e.preventDefault();
 root.querySelector('.feedback-content').addEventListener('input', e => {
   if (e.target !== permission && e.target.id !== 'feedback-answer') permission.checked = false;
   save.disabled = busy || !permission.checked;
 });
 root.querySelector('.feedback-purpose').addEventListener('change',()=>{permission.checked=false;save.disabled=true;});
 root.querySelector('.feedback-selector').onclick = e => {
   const button = e.target.closest('[data-image]');if (!button || busy) return;
   selected = Number(button.dataset.image);root.querySelector('.feedback-image').src=data.assets[selected].url;
   root.querySelectorAll('[data-image]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));
 };
 root.querySelector('.feedback-full').onclick = () => call('feedbackOriginal',{session:data.id,index:selected});
 root.querySelector('.feedback-cancel').onclick = () => {if(!busy) call('feedbackCancel');};
 root.onkeydown = e => {
   if(busy)return;
   if(e.key==='Escape'){e.preventDefault();call('feedbackCancel');}
   if(e.key==='Enter' && e.target.tagName!=='TEXTAREA' && e.target.tagName!=='SELECT' && !e.target.closest('button')){e.preventDefault();if(!save.disabled)save.click();}
   if(e.key==='Tab'){
     const nodes=[...root.querySelectorAll('button,input,textarea,select')].filter(x=>!x.disabled),i=nodes.indexOf(document.activeElement);
     e.preventDefault();nodes[(i+(e.shiftKey?nodes.length-1:1))%nodes.length]?.focus();
   }
 };
 save.onclick = async () => {
   if (busy || !permission.checked) return;
   const payload = {session:data.id,rightsConfirmed:permission.checked,assetIDs:[...root.querySelectorAll('[name=asset]:checked')].map(x=>x.value),standardAnswer:root.querySelector('.feedback-standard').value,purpose:root.querySelector('.feedback-purpose').value};
   busy=true;root.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);
   await call('feedbackSave',payload);
 };
 root.querySelector('#feedback-answer').focus();
}
