export function validUpdateConfig(config) {
  try {
    const url = new URL(config.url);
    const publishers = typeof config.publisherName === 'string' ? [config.publisherName] : config.publisherName;
    return config.provider === 'generic' && url.protocol === 'https:' && !url.username && !url.password
      && Array.isArray(publishers) && publishers.length > 0
      && publishers.every(x => typeof x === 'string' && x.trim());
  } catch { return false; }
}

// electron-updater owns signatures, checksums and file staging.
// This adapter owns user intent, synchronous admission and cancellation.
export function updateController(updater, changed = () => {}) {
  const state = { status: updater ? 'idle' : 'unconfigured', version: null, percent: 0, message: '', notes: '' };
  let busy = false, token = null, canceled = false;
  const set = (status, extra = {}) => { Object.assign(state, { status, message: '' }, extra); changed(); };
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.logger = null;
    updater.on('checking-for-update', () => set('checking'));
    updater.on('update-available', info => set('available', { version: info.version, percent: 0, notes: (typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes ?? []).map(x => x.note ?? '').join('\n')).slice(0, 800) }));
    updater.on('update-not-available', () => set('current', { version: null }));
    updater.on('download-progress', progress => { if (!canceled) set('downloading', { percent: Math.floor(progress.percent) }); });
    updater.on('update-downloaded', () => { if (!canceled) set('downloaded', { percent: 100 }); });
    updater.on('error', error => { if (!canceled) set('error', { message: error.message }); });
  }
  return {
    state,
    async check() {
      if (!updater) throw new Error('This build has no signed Windows update source configured');
      if (busy || state.status === 'downloaded') return;
      busy = true; canceled = false; set('checking');
      try { token = (await updater.checkForUpdates())?.cancellationToken ?? null; }
      catch (error) { set('error', { message: error.message }); }
      finally { busy = false; }
    },
    async download() {
      if (!updater || busy || state.status !== 'available' || !token) return;
      busy = true; canceled = false; set('downloading', { percent: 0 });
      try { await updater.downloadUpdate(token); }
      catch (error) { if (!canceled) set('error', { message: error.message }); }
      finally { busy = false; if (canceled) set('canceled', { percent: 0 }); }
    },
    cancel() {
      if (state.status !== 'downloading' || !token) return;
      canceled = true; token.cancel(); set('canceled', { percent: 0 });
    },
    install() {
      if (updater && !busy && !canceled && state.status === 'downloaded') {
        set('installing');
        try { updater.quitAndInstall(false, true); }
        catch (error) { set('error', { message: error.message }); }
      }
    },
  };
}

// Matches native launch policy: one attempt per day, skipped version suppressed
// only for automatic checks. The UI supplies the platform dialog and safe restart.
export function createUpdateFlow({ controller, load, save, choose, show, notify, canInstall, now = Date.now }) {
  let busy = false;
  const download = async () => {
    show();
    await controller.download();
    if (controller.state.status === 'downloaded' && canInstall()) controller.install();
  };
  return {
    async check(manual = true) {
      if (busy || ['downloading', 'installing'].includes(controller.state.status)) return;
      if (!manual && controller.state.status === 'unconfigured') return;
      busy = true;
      try {
        const preference = load();
        if (!manual) {
          if (preference.lastAttempt > 0 && now() - preference.lastAttempt < 86400000) return;
          save({ ...preference, lastAttempt: now() });
        }
        await controller.check();
        const result = { ...controller.state };
        if (result.status === 'downloaded') { if (manual) show(); return; }
        if (result.status !== 'available') { if (manual) await notify(result); return; }
        if (!manual && preference.skippedVersion === result.version) return;
        const choice = await choose(result, manual);
        if (choice === 2 && !manual) save({ ...load(), skippedVersion: result.version });
        if (choice === 0) await download();
      } finally { busy = false; }
    },
    async download() {
      if (busy || controller.state.status !== 'available') return;
      busy = true;
      try { await download(); } finally { busy = false; }
    },
  };
}
