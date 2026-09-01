import type { UnifiedReplayControllerV1 } from './unified-replay-controller-v1.js';

export function buildUnifiedReplayViewV1(controller: UnifiedReplayControllerV1, prefix: string): void {
  const snapshot = controller.getSnapshot();
  if (!snapshot.replay) return;
  const replay = snapshot.replay;
  const battlefield = element(`${prefix}-battlefield`);
  battlefield.replaceChildren();
  battlefield.style.setProperty('--map-width', String(replay.map.width));
  battlefield.style.aspectRatio = `${replay.map.width} / ${replay.map.height}`;
  for (const cell of replay.map.terrainCells) {
    const node = document.createElement('span');
    node.className = `replay-cell terrain-${cell.terrainId}`;
    if (replay.map.captureZones.some((zone) => cell.x >= zone.x && cell.x < zone.x + zone.width && cell.y >= zone.y && cell.y < zone.y + zone.height)) node.classList.add('capture-zone');
    node.style.gridColumn = String(cell.x + 1);
    node.style.gridRow = String(cell.y + 1);
    battlefield.append(node);
  }
  const timeline = element<HTMLInputElement>(`${prefix}-timeline`);
  timeline.max = String(replay.frames.length - 1);
  const roster = element(`${prefix}-roster`);
  roster.replaceChildren(...replay.participants.map((participant) => {
    const node = document.createElement('article');
    node.className = `replay-player team-${participant.teamId}`;
    node.dataset.teamId = participant.teamId;
    node.append(textNode('b', participant.displayName), textNode('span', `${participant.vehicleName} · ${participant.weaponName}`));
    return node;
  }));
  const moments = element(`${prefix}-moments`);
  moments.replaceChildren(...replay.moments.map((moment) => {
    const node = document.createElement('article');
    node.className = 'replay-moment';
    node.dataset.tick = String(moment.tick);
    node.append(textNode('b', `${moment.tick} 回合 · ${moment.title}`), textNode('span', moment.summary));
    return node;
  }));
  renderUnifiedReplayFrameV1(controller, prefix);
}

export function renderUnifiedReplayFrameV1(controller: UnifiedReplayControllerV1, prefix: string): void {
  const snapshot = controller.getSnapshot();
  if (!snapshot.replay || !snapshot.frame) return;
  const battlefield = element(`${prefix}-battlefield`);
  battlefield.querySelectorAll('.replay-entity').forEach((node) => node.remove());
  for (const tank of snapshot.frame.tanks) {
    const node = document.createElement('span');
    node.className = `replay-entity replay-tank team-${tank.teamId}${tank.alive ? '' : ' destroyed'}`;
    node.style.gridColumn = String(tank.x + 1);
    node.style.gridRow = String(tank.y + 1);
    node.style.transform = `rotate(${tank.bodyDirection * 45}deg)`;
    node.title = `${tank.displayName} · ${tank.hp}/${tank.maxHp} 耐久`;
    const turret = document.createElement('i');
    turret.style.transform = `translateX(-50%) rotate(${(tank.turretDirection - tank.bodyDirection) * 45}deg)`;
    node.append(turret);
    battlefield.append(node);
  }
  for (const projectile of snapshot.frame.projectiles) {
    const node = document.createElement('span');
    node.className = 'replay-entity replay-projectile';
    node.style.gridColumn = String(projectile.x + 1);
    node.style.gridRow = String(projectile.y + 1);
    battlefield.append(node);
  }
  const tanks = new Map(snapshot.frame.tanks.map((tank) => [tank.teamId, tank]));
  element(`${prefix}-roster`).querySelectorAll<HTMLElement>('.replay-player').forEach((node) => {
    node.querySelector('meter')?.remove();
    const tank = tanks.get(node.dataset.teamId ?? '');
    if (!tank) return;
    const meter = document.createElement('meter');
    meter.min = 0; meter.max = tank.maxHp; meter.value = Math.max(0, tank.hp);
    meter.title = `${tank.hp} / ${tank.maxHp} 耐久 · ${tank.ammunition} 发弹药`;
    node.append(meter);
  });
  element<HTMLInputElement>(`${prefix}-timeline`).value = String(snapshot.frameIndex);
  element(`${prefix}-tick`).textContent = `第 ${snapshot.frame.tick} 回合`;
  element(`${prefix}-play`).textContent = snapshot.playing ? '暂停' : '播放';
  element(`${prefix}-objective`).textContent = snapshot.frame.objective
    ? snapshot.frame.objective.contested ? '目标区域争夺中'
      : snapshot.frame.objective.capturingTeamId ? `占领进度 ${snapshot.frame.objective.progress} / ${snapshot.frame.objective.required}` : '目标区域无人占领'
    : '歼灭对方战车';
  element(`${prefix}-moments`).querySelectorAll<HTMLElement>('.replay-moment').forEach((node) => node.classList.toggle('active', Number(node.dataset.tick) === snapshot.frame!.tick));
}

function textNode<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = value; return node;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing unified replay element: ${id}`);
  return value as T;
}
