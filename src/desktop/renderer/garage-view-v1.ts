import type { GarageSnapshotV1, GarageVehicleViewV1 } from '../garage-service-v1.js';
import type { GarageControllerSnapshotV1 } from './garage-controller-v1.js';

export function renderGarageViewV1(snapshot: GarageControllerSnapshotV1): void {
  const garage = snapshot.garage;
  element<HTMLElement>('garage-loading').hidden = snapshot.status !== 'loading' || Boolean(garage);
  element<HTMLElement>('garage-empty').hidden = snapshot.status === 'loading' || Boolean(garage);
  element<HTMLElement>('garage-content').hidden = !garage;
  element<HTMLElement>('garage-damaged').hidden = garage?.status !== 'damaged';
  const error = element<HTMLElement>('garage-error');
  error.hidden = !snapshot.error;
  error.textContent = snapshot.error ?? '';
  setBusy(snapshot.status === 'loading' || snapshot.status === 'saving' || snapshot.status === 'quarantining');
  if (!garage) return;

  element<HTMLElement>('garage-current-badge').textContent = garage.currentRevision
    ? `当前配置 · r${garage.currentRevision}`
    : '等待首个战术版本';
  element<HTMLElement>('garage-damaged-copy').textContent = garage.issue ?? '';
  renderOptions(garage);
  renderRevisionList(garage);
  renderGarageLoadoutPreviewV1(garage);
}

export function renderGarageLoadoutPreviewV1(garage: GarageSnapshotV1): void {
  const vehicleId = element<HTMLSelectElement>('garage-vehicle').value;
  const vehicle = garage.vehicles.find((candidate) => candidate.id === vehicleId) ?? garage.vehicles[0];
  if (!vehicle) return;
  const weaponSelect = element<HTMLSelectElement>('garage-weapon');
  const selectedWeapon = weaponSelect.value;
  replaceOptions(weaponSelect, garage.weapons
    .filter((weapon) => vehicle.compatibleWeaponIds.includes(weapon.id))
    .map((weapon) => ({ value: weapon.id, label: weapon.name })));
  if (Array.from(weaponSelect.options).some((option) => option.value === selectedWeapon)) weaponSelect.value = selectedWeapon;
  const weapon = garage.weapons.find((candidate) => candidate.id === weaponSelect.value);
  const preview = element<HTMLElement>('garage-loadout-preview');
  preview.replaceChildren(
    stat('生存', `${vehicle.maxHp} 耐久`, `装甲 ${vehicle.armor.front}/${vehicle.armor.side}/${vehicle.armor.rear}`),
    stat('机动', `${vehicle.topSpeed} 速度`, `视野 ${vehicle.vision} 格`),
    stat('火力', weapon ? `${weapon.damage} 伤害` : '未装备', weapon ? `${weapon.ammunition} 发 · ${weapon.reload} 回合装填` : ''),
  );
}

function renderOptions(garage: GarageSnapshotV1): void {
  const current = garage.revisions.find((revision) => revision.revision === garage.currentRevision);
  const vehicle = garage.vehicles.find((candidate) => candidate.name === current?.vehicleName);
  const tactic = garage.tactics.find((candidate) => candidate.name === current?.tacticName);
  const vehicleSelect = element<HTMLSelectElement>('garage-vehicle');
  const tacticSelect = element<HTMLSelectElement>('garage-tactic');
  if (vehicleSelect.options.length === 0) {
    replaceOptions(vehicleSelect, garage.vehicles.map((candidate) => ({ value: candidate.id, label: `${candidate.name} · ${roleName(candidate)}` })));
    if (vehicle) vehicleSelect.value = vehicle.id;
  }
  if (tacticSelect.options.length === 0) {
    replaceOptions(tacticSelect, garage.tactics.map((candidate) => ({ value: candidate.id, label: `${candidate.name} · ${candidate.description}` })));
    if (tactic) tacticSelect.value = tactic.id;
  }
  const label = element<HTMLInputElement>('garage-label');
  if (!label.value && current) label.value = current.label;
}

function renderRevisionList(garage: GarageSnapshotV1): void {
  const list = element<HTMLElement>('garage-revision-list');
  list.replaceChildren(...[...garage.revisions].reverse().map((revision) => {
    const card = document.createElement('article');
    card.className = `revision-card${revision.revision === garage.currentRevision ? ' current' : ''}${revision.state === 'healthy' ? '' : ' damaged'}`;
    const header = document.createElement('header');
    const copy = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.textContent = `版本 r${revision.revision}`;
    const title = document.createElement('h3');
    title.textContent = revision.label;
    copy.append(eyebrow, title);
    const badge = document.createElement('b');
    badge.textContent = revision.revision === garage.currentRevision ? '当前使用' : revision.state === 'healthy' ? '可用' : '需要隔离';
    header.append(copy, badge);
    const loadout = paragraph('revision-loadout', revision.state === 'healthy'
      ? `${revision.vehicleName} · ${revision.weaponName} · ${revision.tacticName}`
      : revision.issue ?? '此版本无法使用');
    const note = paragraph('revision-note', revision.note || '没有补充说明');
    const changes = paragraph('revision-changes', revision.changes.join('；'));
    const record = document.createElement('div');
    record.className = 'revision-record';
    record.append(
      textSpan(`胜 ${revision.record.wins}`),
      textSpan(`负 ${revision.record.losses}`),
      textSpan(`平 ${revision.record.draws}`),
    );
    card.append(header, loadout, note, changes, record);
    return card;
  }));
}

function stat(title: string, value: string, detail: string): HTMLElement {
  const node = document.createElement('div');
  const heading = document.createElement('b');
  heading.textContent = `${title} · ${value}`;
  const copy = document.createElement('span');
  copy.textContent = detail;
  node.append(heading, copy);
  return node;
}

function roleName(vehicle: GarageVehicleViewV1): string {
  return vehicle.role === 'scout' ? '快速侦察' : vehicle.role === 'heavy' ? '正面推进' : '攻守均衡';
}

function replaceOptions(select: HTMLSelectElement, options: Array<{ value: string; label: string }>): void {
  select.replaceChildren(...options.map(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const node = document.createElement('p');
  node.className = className;
  node.textContent = text;
  return node;
}

function textSpan(text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.textContent = text;
  return node;
}

function setBusy(busy: boolean): void {
  for (const id of ['garage-save', 'garage-quarantine', 'garage-export-diagnostic']) {
    element<HTMLButtonElement>(id).disabled = busy;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing garage element: ${id}`);
  return value as T;
}
