import type { FriendRoomReplayV1 } from '../../friend-room/replay-v1.js';
import type { OnboardingSnapshotV1 } from './onboarding-controller-v1.js';

const PHASE_IDS = ['commander', 'doctrine', 'battle', 'running', 'replay'] as const;

export function renderOnboardingV1(snapshot: OnboardingSnapshotV1, visible: boolean): void {
  const overlay = element<HTMLElement>('onboarding-overlay');
  overlay.hidden = !visible;
  if (!visible) return;
  PHASE_IDS.forEach((phase) => {
    element<HTMLElement>(`onboarding-${phase}`).hidden = snapshot.phase !== phase;
  });
  const error = element<HTMLElement>('onboarding-error');
  error.hidden = !snapshot.error;
  error.textContent = snapshot.error ?? '';
  element<HTMLElement>('onboarding-progress').textContent = progressCopy(snapshot.phase);
  if (snapshot.phase === 'replay' && snapshot.result) renderTutorialResult(snapshot.result.replay, snapshot.result.lessons);
}

function renderTutorialResult(replay: FriendRoomReplayV1, lessons: Array<{ title: string; detail: string }>): void {
  const winners = replay.result.winningTeamIds;
  element<HTMLElement>('tutorial-replay-summary').textContent = winners.length
    ? `${replay.participants.filter((item) => winners.includes(item.teamId)).map((item) => item.displayName).join('、')} 赢得教学战斗`
    : '双方战成平局；观察关键时刻，再调整推进路线。';
  const lessonNodes = lessons.map((lesson) => {
    const article = document.createElement('article');
    const title = document.createElement('b');
    const detail = document.createElement('span');
    title.textContent = lesson.title;
    detail.textContent = lesson.detail;
    article.append(title, detail);
    return article;
  });
  element<HTMLElement>('tutorial-lessons').replaceChildren(...lessonNodes);
  renderFinalFrame(replay);
}

function renderFinalFrame(replay: FriendRoomReplayV1): void {
  const field = element<HTMLElement>('tutorial-battlefield');
  field.replaceChildren();
  field.style.setProperty('--map-width', String(replay.map.width));
  field.style.aspectRatio = `${replay.map.width} / ${replay.map.height}`;
  for (const cell of replay.map.terrainCells) {
    const node = document.createElement('span');
    node.className = `replay-cell terrain-${cell.terrainId}`;
    node.style.gridColumn = String(cell.x + 1);
    node.style.gridRow = String(cell.y + 1);
    field.append(node);
  }
  for (const tank of replay.frames.at(-1)?.tanks ?? []) {
    const node = document.createElement('span');
    node.className = `replay-entity replay-tank team-${tank.teamId}${tank.alive ? '' : ' destroyed'}`;
    node.style.gridColumn = String(tank.x + 1);
    node.style.gridRow = String(tank.y + 1);
    node.title = `${tank.displayName} · ${tank.hp}/${tank.maxHp}`;
    field.append(node);
  }
}

function progressCopy(phase: OnboardingSnapshotV1['phase']): string {
  if (phase === 'commander' || phase === 'doctrine') return '第 1 步，共 3 步';
  if (phase === 'battle' || phase === 'running') return '第 2 步，共 3 步';
  return '第 3 步，共 3 步';
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing onboarding element: ${id}`);
  return value as T;
}
