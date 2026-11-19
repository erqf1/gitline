// Mit dem Server reden: Abrufen (fetch), Pull, Push, Klonen - mit Fortschritt und Abbrechen.
// Anmeldung macht der Credential Manager des Systems, Gitline sieht und speichert keine Passwörter.
import { confirm, toast } from './ui.js';
import { S, t, g, api, emit, showError } from './common.js';
import { remoteDialog, askIdentity } from './dialogs.js';

let nextId = 1;
S.op = null;

api.onProgress((p) => {
  if (!S.op || p.id !== S.op.id) return;
  S.op.ratio = Math.max(S.op.ratio || 0, p.ratio || 0);
  S.op.text = p.text;
  emit('progress');
});

/** Läuft etwas mit dem Server? */
export const remoteBusy = () => !!S.op;

export async function remoteOp(name, label, ...args) {
  if (S.op) {
    toast(t('busyRemote'));
    return undefined;
  }
  const id = `r${nextId++}`;
  S.op = { id, label, ratio: 0, text: '' };
  emit('progress');
  try {
    return await api.remote(name, id, ...args);
  } catch (e) {
    if (S.op && S.op.cancelled) toast(t('cancelled'));
    else throw e;
    return undefined;
  } finally {
    S.op = null;
    emit('progress');
    api.setProgress(null);
  }
}
export function cancelOp() {
  if (!S.op) return;
  S.op.cancelled = true;
  api.cancel(S.op.id);
}

const needRemote = async () => {
  if (S.status && S.status.remotes.length) return true;
  const r = await confirm(t('noRemoteTitle'), t('noRemoteMsg'), [{ label: t('cancel'), value: 'cancel' }, { label: t('remoteAdd'), value: 'ok', primary: true }]);
  if (r !== 'ok') return false;
  await remoteDialog();
  const st = await g('status');
  return st.remotes.length > 0;
};

async function guarded(fn, title) {
  S.busy++;
  emit('busy');
  try {
    return await fn();
  } catch (e) {
    await showError(e, title);
    return undefined;
  } finally {
    S.busy--;
    emit('busy');
    emit('refresh');
  }
}

export async function fetchAll({ quiet = false } = {}) {
  if (!S.repo || S.op) return;
  if (!(S.status && S.status.remotes.length)) {
    if (!quiet) await needRemote();
    return;
  }
  if (quiet) {
    try {
      await remoteOp('fetch', t('fetching'), S.repo);
      emit('refresh');
    } catch {
      // im Hintergrund still
    }
    return;
  }
  const r = await guarded(() => remoteOp('fetch', t('fetching'), S.repo).then(() => true), t('fetchFailed'));
  if (r) toast(t('fetchDone'));
}

export async function pull() {
  if (!S.repo || !(await needRemote())) return;
  const st = S.status;
  if (!st.upstream) {
    toast(t('noUpstreamPull'), { kind: 'error' });
    return;
  }
  const r = await guarded(async () => {
    try {
      return await remoteOp('pull', t('pulling'), S.repo, { rebase: S.settings.pullMode === 'rebase' });
    } catch (e) {
      if (e.code === 'NO_IDENTITY' && (await askIdentity())) return remoteOp('pull', t('pulling'), S.repo, { rebase: S.settings.pullMode === 'rebase' });
      throw e;
    }
  }, t('pullFailed'));
  if (!r) return;
  if (r.conflict) {
    await confirm(t('conflictTitle'), t('pullConflictMsg'), [{ label: t('ok'), value: 'ok', primary: true }]);
    emit('tab', 'changes');
  } else toast(t('pullDone'));
}

export async function push({ force = false } = {}) {
  if (!S.repo || !(await needRemote())) return;
  const st = S.status;
  if (!st.branch) {
    toast(t('needBranch'), { kind: 'error' });
    return;
  }
  const setUpstream = !st.upstream;
  const remote = setUpstream ? (st.remotes.includes('origin') ? 'origin' : st.remotes[0]) : null;
  let rejected = false;
  const r = await guarded(async () => {
    try {
      await remoteOp('push', setUpstream ? t('publishing') : t('pushing'), S.repo, { branch: st.branch, remote, setUpstream, force });
      return true;
    } catch (e) {
      if (e.code === 'REJECTED') {
        rejected = true;
        return false;
      }
      throw e;
    }
  }, t('pushFailed'));
  if (rejected) {
    const a = await confirm(t('rejectedTitle'), t('rejectedMsg'), [{ label: t('cancel'), value: 'cancel' }, { label: t('pullNow'), value: 'pull', primary: true }]);
    if (a === 'pull') await pull();
    return;
  }
  if (r) toast(setUpstream ? t('publishDone', { b: st.branch }) : t('pushDone'));
}

/** Branch aus der Branch-Liste pushen (auch einen, der gerade nicht ausgecheckt ist) */
export async function pushBranch(b) {
  if (!S.repo || !(await needRemote())) return;
  if (b.current) return push();
  const remote = S.status.remotes.includes('origin') ? 'origin' : S.status.remotes[0];
  const r = await guarded(() => remoteOp('push', t('pushing'), S.repo, { branch: b.name, remote, setUpstream: !b.upstream, ref: b.name }).then(() => true), t('pushFailed'));
  if (r) toast(t('pushDone'));
}

export async function pushTag(name) {
  if (!S.repo || !(await needRemote())) return;
  const remote = S.status.remotes.includes('origin') ? 'origin' : S.status.remotes[0];
  const r = await guarded(() => remoteOp('pushTag', t('pushing'), S.repo, remote, name).then(() => true), t('pushFailed'));
  if (r) toast(t('tagPushed', { t: name }));
}
