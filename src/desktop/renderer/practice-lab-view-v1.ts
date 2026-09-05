import type { GarageSnapshotV1 } from '../garage-service-v1.js';
import type { PracticeLabSnapshotV1 } from './practice-lab-controller-v1.js';

export function renderPracticeLabV1(snapshot: PracticeLabSnapshotV1, garage?: GarageSnapshotV1): void {
  const available = snapshot.availableRevisions;
  const ready = available.length >= 1;
  element<HTMLElement>('practice-empty').hidden = ready;
  element<HTMLElement>('practice-arena').hidden = !ready;
  const error = element<HTMLElement>('practice-error');
  error.hidden = !snapshot.error;
  error.textContent = snapshot.error ?? '';
  if (!ready) return;
  renderRevisionOptions(available, garage);

  element<HTMLElement>('practice-ready').hidden = snapshot.status !== 'idle';
  element<HTMLElement>('practice-running').hidden = snapshot.status !== 'running';
  element<HTMLElement>('practice-success').hidden = snapshot.status !== 'complete' || !snapshot.result;
  for (const id of ['practice-run-versus', 'practice-run-mirror']) {
    element<HTMLButtonElement>(id).disabled = snapshot.status === 'running';
  }
  if (!snapshot.result) return;

  const outcome = snapshot.result.outcome;
  element<HTMLElement>('practice-result-eyebrow').textContent = outcome === 'victory'
    ? '训练胜利'
    : outcome === 'defeat'
      ? '训练失利'
      : '训练平局';
  element<HTMLElement>('practice-result-title').textContent = outcome === 'victory'
    ? '这套调整经受住了考验'
    : outcome === 'defeat'
      ? '旧版本找到了它的破绽'
      : '双方战术势均力敌';
  element<HTMLElement>('practice-result-summary').textContent = `${snapshot.result.modeName} · ${snapshot.result.ticks} 回合 · r${snapshot.result.currentRevision} 对战 r${snapshot.result.opponentRevision}`;
  const moments = element<HTMLElement>('practice-moments');
  moments.replaceChildren(...snapshot.result.moments.map((moment) => {
    const node = document.createElement('article');
    const title = document.createElement('b');
    title.textContent = `${moment.tick} 回合 · ${moment.title}`;
    const summary = document.createElement('span');
    summary.textContent = moment.summary;
    node.append(title, summary);
    return node;
  }));
}

function renderRevisionOptions(revisions: number[], garage?: GarageSnapshotV1): void {
  const current = element<HTMLSelectElement>('practice-current');
  const opponent = element<HTMLSelectElement>('practice-opponent');
  const key = revisions.join(',');
  if (current.dataset.revisions === key && opponent.dataset.revisions === key) return;
  const descending = [...revisions].sort((a, b) => b - a);
  const makeOptions = () => descending.map((revision) => {
    const option = document.createElement('option');
    option.value = String(revision);
    const label = garage?.revisions.find((candidate) => candidate.revision === revision)?.label;
    option.textContent = `r${revision} · ${label ?? '战术版本'}`;
    return option;
  });
  current.replaceChildren(...makeOptions());
  opponent.replaceChildren(...makeOptions());
  current.value = String(descending[0]);
  opponent.value = String(descending[1] ?? descending[0]);
  current.dataset.revisions = key;
  opponent.dataset.revisions = key;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing practice element: ${id}`);
  return value as T;
}
