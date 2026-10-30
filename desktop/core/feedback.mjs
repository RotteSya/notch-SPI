import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export const feedbackContact = 'raysyadesu@gmail.com';
export const feedbackPurposes = ['support_review', 'quality_evaluation'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Keep the exact material and answer presented for consent; never read a newer turn at save time.
export function feedbackSnapshot({images, answer, captureID = randomUUID(), sessionID = randomUUID(), expiresAt}, inspectImage) {
  if (!answer?.trim() || Buffer.byteLength(answer) > 65536 || !images.length || images.length > 4)
    throw new Error('invalidSelection');
  if (new Set(images.map(x => x.id)).size !== images.length) throw new Error('invalidSelection');
  const assets = images.map((image, i) => {
    const data = Buffer.from(image.base64, 'base64');
    const info = inspectImage(data);
    if (!data.length || data.length > 2 * 1024 * 1024 || !info || !['png','jpg'].includes(info.extension) ||
        info.width !== image.width || info.height !== image.height || info.width <= 0 || info.height <= 0 || info.width * info.height > 16000000)
      throw new Error('changedMaterial');
    return { id: image.id, data, sha256: digest(data), widthPx: info.width, heightPx: info.height,
      byteCount: data.length, extension: info.extension, role: i === images.length - 1 ? 'question' : 'reference' };
  });
  return { id: randomUUID(), captureID, sessionID, answer, expiresAt, assets };
}
export function authorizeFeedback(snapshot, selection, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= now) throw new Error('expired');
  if (selection?.session !== snapshot.id || selection.rightsConfirmed !== true || !feedbackPurposes.includes(selection.purpose))
    throw new Error('unauthorized');
  if (!Array.isArray(selection.assetIDs) || new Set(selection.assetIDs).size !== selection.assetIDs.length ||
      selection.assetIDs.some(id => !snapshot.assets.some(a => a.id === id))) throw new Error('invalidSelection');
  if (typeof selection.standardAnswer !== 'string' || Buffer.byteLength(selection.standardAnswer) > 16384) throw new Error('invalidSelection');
  return { assetIDs: [...selection.assetIDs], standardAnswer: selection.standardAnswer.trim() || null,
    authorization: { version:'feedback-v2', purpose:selection.purpose, rights_confirmed:true,
      authorized_at:new Date(now).toISOString(), expires_at:new Date(now + 90 * 86400000).toISOString(),
      external_processing:'requires_separate_permission', withdrawal_contact:feedbackContact } };
}
export async function writeFeedback(snapshot, selection, destination, now = Date.now()) {
  // Revalidate after the Save dialog, including expiry and the authorization scope.
  const a = selection.authorization;
  if (!a || a.version !== 'feedback-v2' || a.rights_confirmed !== true || !feedbackPurposes.includes(a.purpose) ||
      Date.parse(a.authorized_at) > now || !(Date.parse(a.expires_at) > now) ||
      Date.parse(a.expires_at) - Date.parse(a.authorized_at) !== 90 * 86400000 ||
      a.external_processing !== 'requires_separate_permission' || a.withdrawal_contact !== feedbackContact) throw new Error('unauthorized');
  authorizeFeedback(snapshot, {session:snapshot.id, rightsConfirmed:true, purpose:a.purpose, assetIDs:selection.assetIDs, standardAnswer:selection.standardAnswer ?? ''}, now);
  if (!path.isAbsolute(destination) || path.extname(destination).toLowerCase() !== '.json') throw new Error('invalidDestination');
  const submissionID = randomUUID();
  const folder = path.join(path.dirname(destination), `notchspi-feedback-${submissionID}-assets`);
  await fs.mkdir(folder, {mode:0o700});
  let committed = false;
  try {
    const assets = [];
    for (const asset of snapshot.assets.filter(x => selection.assetIDs.includes(x.id))) {
      if (asset.data.length !== asset.byteCount || digest(asset.data) !== asset.sha256) throw new Error('changedMaterial');
      const name = `${String(assets.length + 1).padStart(2,'0')}-${asset.role}.${asset.extension}`;
      await fs.writeFile(path.join(folder,name), asset.data, {flag:'wx',mode:0o600});
      assets.push({file:`${path.basename(folder)}/${name}`,role:asset.role,ordinal:assets.length,sha256:asset.sha256,
        widthPx:asset.widthPx,heightPx:asset.heightPx,byteCount:asset.byteCount});
    }
    const manifest = {submission_id:submissionID,authorization_version:a.version,authorization:a,purpose:a.purpose,
      retention:'local_until_user_deletes',exported_at:new Date(now).toISOString(),capture_id:snapshot.captureID,
      session_id:snapshot.sessionID,answer:snapshot.answer,...(selection.standardAnswer ? {standard_answer:selection.standardAnswer} : {}),assets};
    const staging = path.join(folder,'manifest.json');
    await fs.writeFile(staging,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
    await fs.rename(staging,destination);
    committed = true;
    return submissionID;
  } finally { if (!committed) await fs.rm(folder,{recursive:true,force:true}); }
}
