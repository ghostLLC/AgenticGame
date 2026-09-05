import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SavedBuildRepositoryV2,
  type SavedBuildInspectionV2,
  type SavedBuildRevisionInspectionV2,
} from '../config/saved-build-repository-v2.js';
import type { SavedBuildDraftV2, SavedBuildV2 } from '../config/saved-build-v2.js';
import { GAMEPLAY_CONTENT_V2 } from '../core/v2/gameplay-content.js';
import { ReplayRepositoryV2 } from '../replay/repository-v2.js';
import {
  BuildRevisionNoteRepositoryV1,
  type BuildRevisionNoteV1,
  type GarageTacticIdV1,
} from './build-revision-note-repository-v1.js';
import type { PlayerDoctrineV1, PlayerProfileV1 } from './player-profile-v1.js';
import { presetTacticSourceV2 } from './preset-tactics-v2.js';

export type { GarageTacticIdV1 } from './build-revision-note-repository-v1.js';

export const COMMANDER_BUILD_ID_V1 = 'commander-main';

export interface GarageSaveInputV1 {
  label: string;
  vehicleId: 'scout' | 'medium' | 'heavy';
  weaponId: 'light-cannon' | 'medium-cannon' | 'heavy-cannon';
  tacticId: GarageTacticIdV1;
  note: string;
  baseRevision?: number;
  replaceTactic?: boolean;
}

export interface GarageBattleRecordV1 {
  wins: number;
  losses: number;
  draws: number;
}

export interface GarageRevisionViewV1 {
  revision: number;
  state: 'healthy' | 'corrupt' | 'untrusted';
  label: string;
  createdAt: string;
  vehicleName: string;
  weaponName: string;
  tacticName: string;
  tacticId?: GarageTacticIdV1;
  sourceKind?: 'preset' | 'custom';
  note: string;
  changes: string[];
  record: GarageBattleRecordV1;
  selectable: boolean;
  issue?: string;
}

export interface GarageVehicleViewV1 {
  id: 'scout' | 'medium' | 'heavy';
  name: string;
  role: string;
  maxHp: number;
  armor: { front: number; side: number; rear: number };
  topSpeed: number;
  vision: number;
  compatibleWeaponIds: string[];
}

export interface GarageWeaponViewV1 {
  id: 'light-cannon' | 'medium-cannon' | 'heavy-cannon';
  name: string;
  damage: number;
  penetration: number;
  range: number;
  reload: number;
  ammunition: number;
}

export interface GarageSnapshotV1 {
  status: 'ready' | 'damaged';
  buildId: typeof COMMANDER_BUILD_ID_V1;
  currentRevision?: number;
  vehicles: GarageVehicleViewV1[];
  weapons: GarageWeaponViewV1[];
  tactics: Array<{ id: GarageTacticIdV1; name: string; description: string }>;
  revisions: GarageRevisionViewV1[];
  issue?: string;
}

export interface GarageDiagnosticExportV1 {
  fileName: string;
}

export interface GarageServiceOptionsV1 {
  buildRepository: SavedBuildRepositoryV2;
  noteRepository: BuildRevisionNoteRepositoryV1;
  replayRepository: ReplayRepositoryV2;
  diagnosticsRoot: string;
  now?: () => string;
}

const TACTICS: Record<GarageTacticIdV1, { name: string; description: string }> = {
  scout: { name: '游骑侦察', description: '快速机动，寻找侧翼机会' },
  medium: { name: '中线突击', description: '攻守均衡，持续向中心施压' },
  heavy: { name: '钢铁堡垒', description: '依靠正面装甲稳住阵线' },
};

export class GarageServiceV1 {
  private readonly buildRepository: SavedBuildRepositoryV2;
  private readonly noteRepository: BuildRevisionNoteRepositoryV1;
  private readonly replayRepository: ReplayRepositoryV2;
  private readonly diagnosticsRoot: string;
  private readonly now: () => string;

  constructor(options: GarageServiceOptionsV1) {
    this.buildRepository = options.buildRepository;
    this.noteRepository = options.noteRepository;
    this.replayRepository = options.replayRepository;
    this.diagnosticsRoot = resolve(options.diagnosticsRoot);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async getSnapshot(profile: PlayerProfileV1): Promise<GarageSnapshotV1> {
    await this.ensureInitialRevision(profile);
    const inspection = await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1);
    const notes = await this.safeNotes(inspection);
    const records = await this.battleRecords(inspection);
    const revisions = inspection.revisions.map((item, index) => this.toRevisionView(
      item,
      index > 0 ? inspection.revisions[index - 1] : undefined,
      notes,
      records,
    ));
    const damaged = revisions.some((revision) => revision.state !== 'healthy');
    return {
      status: damaged ? 'damaged' : 'ready',
      buildId: COMMANDER_BUILD_ID_V1,
      ...(inspection.latestHealthy ? { currentRevision: inspection.latestHealthy.revision } : {}),
      vehicles: vehicleViews(),
      weapons: weaponViews(),
      tactics: Object.entries(TACTICS).map(([id, tactic]) => ({
        id: id as GarageTacticIdV1,
        ...tactic,
      })),
      revisions,
      ...(damaged ? { issue: '部分版本未通过完整性校验。健康版本仍可使用，隔离损坏版本后可继续保存。' } : {}),
    };
  }

  async initialize(profile: PlayerProfileV1): Promise<void> { await this.ensureInitialRevision(profile); }

  async saveRevision(profile: PlayerProfileV1, input: GarageSaveInputV1): Promise<GarageSnapshotV1> {
    await this.ensureInitialRevision(profile);
    const inspection = await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1);
    if (inspection.revisions.some((revision) => revision.state !== 'healthy')) {
      throw new Error('请先隔离损坏版本，再保存新配置。');
    }
    const latest = inspection.latestHealthy;
    if (!latest) throw new Error('当前没有可用战术版本。');
    const normalized = validateSaveInput(input);
    const source = normalized.replaceTactic === true ? tacticSource(normalized.tacticId) : latest.botArtifact.source;
    const draft: SavedBuildDraftV2 = {
      buildId: COMMANDER_BUILD_ID_V1,
      label: normalized.label,
      bot: {
        artifactId: latest.botArtifact.artifactId,
        version: source === latest.botArtifact.source ? latest.botArtifact.version : `1.0.${latest.revision}`,
        language: 'javascript',
        entryPoint: latest.botArtifact.entryPoint,
        source,
      },
      loadout: {
        vehicleId: normalized.vehicleId,
        weaponId: normalized.weaponId,
        equipmentIds: [...latest.loadout.equipmentIds],
      },
    };
    const createdAt = this.now();
    const previousNote = await this.noteRepository.load(COMMANDER_BUILD_ID_V1, latest.revision).catch(() => undefined);
    await this.buildRepository.save(draft, createdAt, {
      expectedRevision: normalized.baseRevision ?? latest.revision,
      beforePublish: async (record) => { await this.noteRepository.save({
        version: 1,
        buildId: COMMANDER_BUILD_ID_V1,
        revision: record.revision,
        tacticId: normalized.replaceTactic ? normalized.tacticId : previousNote?.tacticId ?? normalized.tacticId,
        note: normalized.note,
        createdAt: record.createdAt,
      }, { replace: true }); },
    });
    return this.getSnapshot(profile);
  }

  async quarantineDamagedHistory(profile: PlayerProfileV1): Promise<GarageSnapshotV1> {
    const inspection = await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1);
    const damaged = inspection.revisions.find((revision) => revision.state === 'corrupt');
    if (!damaged) throw new Error('没有需要隔离的损坏版本。');
    const result = await this.buildRepository.quarantineFrom(COMMANDER_BUILD_ID_V1, damaged.revision);
    await this.noteRepository.quarantineFrom(COMMANDER_BUILD_ID_V1, damaged.revision, result.quarantineId);
    return this.getSnapshot(profile);
  }

  async exportDiagnostic(profile: PlayerProfileV1): Promise<GarageDiagnosticExportV1> {
    await this.ensureInitialRevision(profile);
    const inspection = await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1);
    const createdAt = this.now();
    const fileName = `garage-diagnostic-${createdAt.replace(/[:.]/g, '-')}.json`;
    const report = {
      version: 1,
      createdAt,
      buildId: COMMANDER_BUILD_ID_V1,
      revisions: inspection.revisions.map((revision) => ({
        revision: revision.revision,
        state: revision.state,
        ...(revision.state === 'healthy' ? {} : { message: revision.message }),
      })),
    };
    await atomicWrite(resolve(this.diagnosticsRoot, fileName), `${JSON.stringify(report, null, 2)}\n`);
    return { fileName };
  }

  private async ensureInitialRevision(profile: PlayerProfileV1): Promise<void> {
    const inspection = await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1);
    if (inspection.revisions.length > 0) return;
    const doctrine = profile.doctrine;
    const input = doctrineInput(profile.displayName, doctrine);
    await this.buildRepository.save(buildDraft(input, '1.0.0'), profile.createdAt, {
      expectedRevision: 0,
      beforePublish: async (record) => { await this.noteRepository.save({
        version: 1,
        buildId: COMMANDER_BUILD_ID_V1,
        revision: record.revision,
        tacticId: doctrine,
        note: '首次作战配置',
        createdAt: profile.createdAt,
      }, { replace: true }); },
    }).catch(async (error) => {
      // Another process may have initialized the same profile in the meantime.
      if (!(await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1)).latestHealthy) throw error;
    });
  }

  private async safeNotes(inspection: SavedBuildInspectionV2): Promise<Map<number, BuildRevisionNoteV1>> {
    const notes = new Map<number, BuildRevisionNoteV1>();
    for (const item of inspection.revisions) {
      try { notes.set(item.revision, await this.noteRepository.load(COMMANDER_BUILD_ID_V1, item.revision)); } catch { /* isolate this annotation */ }
    }
    return notes;
  }

  private async battleRecords(inspection: SavedBuildInspectionV2): Promise<Map<number, GarageBattleRecordV1>> {
    const healthy = inspection.revisions.flatMap((item) => item.state === 'healthy' ? [item.record] : []);
    const records = new Map(healthy.map((record) => [record.revision, emptyRecord()]));
    let entries;
    try {
      entries = (await this.replayRepository.inspect()).flatMap((entry) => entry.state === 'healthy' ? [entry.entry] : []);
    } catch {
      return records;
    }
    const byIdentity = new Map<string, number[]>();
    for (const build of healthy) {
      const key = JSON.stringify([`${build.label} r${build.revision}`.slice(0, 80), build.botArtifact.codeHash, build.loadout.vehicleId, build.loadout.weaponId]);
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), build.revision]);
    }
    for (const entry of entries) {
      const winners = new Set(entry.winningTeamIds);
      const counted = new Set<number>();
      for (const team of entry.teams) {
        const key = JSON.stringify([team.displayName, team.codeHash, team.vehicleId, team.weaponId]);
        for (const revision of byIdentity.get(key) ?? []) {
          if (counted.has(revision)) continue;
          counted.add(revision);
          const record = records.get(revision)!;
          if (winners.size === 0) record.draws += 1;
          else if (winners.has(team.teamId)) record.wins += 1;
          else record.losses += 1;
        }
      }
    }
    return records;
  }

  private toRevisionView(
    item: SavedBuildRevisionInspectionV2,
    previous: SavedBuildRevisionInspectionV2 | undefined,
    notes: ReadonlyMap<number, BuildRevisionNoteV1>,
    records: ReadonlyMap<number, GarageBattleRecordV1>,
  ): GarageRevisionViewV1 {
    if (item.state !== 'healthy') {
      return {
        revision: item.revision,
        state: item.state,
        label: item.state === 'corrupt' ? '损坏版本' : '无法验证的后续版本',
        createdAt: '',
        vehicleName: '不可用',
        weaponName: '不可用',
        tacticName: '不可用',
        note: '',
        changes: [],
        record: emptyRecord(),
        selectable: false,
        issue: item.message,
      };
    }
    const note = notes.get(item.revision);
    const previousRecord = previous?.state === 'healthy' ? previous.record : undefined;
    const previousNote = previousRecord ? notes.get(previousRecord.revision) : undefined;
    return {
      revision: item.revision,
      state: 'healthy',
      label: item.record.label,
      createdAt: item.record.createdAt,
      vehicleName: vehicleName(item.record.loadout.vehicleId),
      weaponName: weaponName(item.record.loadout.weaponId),
      tacticName: Object.values(TACTICS).some((_, index) => tacticSource(Object.keys(TACTICS)[index] as GarageTacticIdV1) === item.record.botArtifact.source)
        ? (note ? TACTICS[note.tacticId].name : '预设战术') : '自定义战术',
      ...(note ? { tacticId: note.tacticId } : { issue: '此版本的说明缺失或损坏，战术仍可使用；保存说明即可修复。' }),
      sourceKind: Object.keys(TACTICS).some((id) => tacticSource(id as GarageTacticIdV1) === item.record.botArtifact.source) ? 'preset' : 'custom',
      note: note?.note ?? '',
      changes: revisionChanges(item.record, note, previousRecord, previousNote),
      record: structuredClone(records.get(item.revision) ?? emptyRecord()),
      selectable: true,
    };
  }
}

function doctrineInput(displayName: string, doctrine: PlayerDoctrineV1): GarageSaveInputV1 {
  const vehicleId = doctrine;
  const weaponId = doctrine === 'scout' ? 'light-cannon' : doctrine === 'medium' ? 'medium-cannon' : 'heavy-cannon';
  return {
    label: `${displayName}的主力战车`,
    vehicleId,
    weaponId,
    tacticId: doctrine,
    note: '首次作战配置',
  };
}

function buildDraft(input: GarageSaveInputV1, version: string): SavedBuildDraftV2 {
  return {
    buildId: COMMANDER_BUILD_ID_V1,
    label: input.label,
    bot: {
      artifactId: 'commander-main-bot',
      version,
      language: 'javascript',
      entryPoint: 'commander-main.js',
      source: tacticSource(input.tacticId),
    },
    loadout: { vehicleId: input.vehicleId, weaponId: input.weaponId, equipmentIds: [] },
  };
}

function validateSaveInput(input: GarageSaveInputV1): GarageSaveInputV1 {
  if (!input || typeof input !== 'object') throw new Error('战术配置无效。');
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if ([...label].length < 1 || [...label].length > 80) throw new Error('版本名称需要 1–80 个字符。');
  if ([...note].length > 240) throw new Error('修改说明不能超过 240 个字符。');
  const vehicle = GAMEPLAY_CONTENT_V2.vehicles.find((item) => item.id === input.vehicleId);
  if (!vehicle) throw new Error('请选择可用战车。');
  if (!vehicle.compatibleWeaponIds.includes(input.weaponId)) throw new Error('所选主炮与战车不兼容。');
  if (!(input.tacticId in TACTICS)) throw new Error('请选择可用战术。');
  if (input.baseRevision !== undefined && (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1)) throw new Error('编辑版本无效。');
  if (input.replaceTactic !== undefined && typeof input.replaceTactic !== 'boolean') throw new Error('战术替换选项无效。');
  return { ...input, label, note };
}

function tacticSource(tacticId: GarageTacticIdV1): string {
  return presetTacticSourceV2(tacticId);
}

function revisionChanges(
  current: SavedBuildV2,
  currentNote: BuildRevisionNoteV1 | undefined,
  previous: SavedBuildV2 | undefined,
  previousNote: BuildRevisionNoteV1 | undefined,
): string[] {
  if (!previous) return ['创建首个版本'];
  const changes: string[] = [];
  if (current.label !== previous.label) changes.push(`版本名称：${previous.label} → ${current.label}`);
  if (current.loadout.vehicleId !== previous.loadout.vehicleId) {
    changes.push(`战车：${vehicleName(previous.loadout.vehicleId)} → ${vehicleName(current.loadout.vehicleId)}`);
  }
  if (current.loadout.weaponId !== previous.loadout.weaponId) {
    changes.push(`主炮：${weaponName(previous.loadout.weaponId)} → ${weaponName(current.loadout.weaponId)}`);
  }
  if (currentNote?.tacticId !== previousNote?.tacticId) {
    changes.push(`战术：${previousNote ? TACTICS[previousNote.tacticId].name : '未知'} → ${currentNote ? TACTICS[currentNote.tacticId].name : '未知'}`);
  }
  if (current.botArtifact.codeHash !== previous.botArtifact.codeHash) changes.push('更新战术代码');
  return changes.length > 0 ? changes : ['配置内容未变化'];
}

function vehicleName(id: string): string {
  return GAMEPLAY_CONTENT_V2.vehicles.find((vehicle) => vehicle.id === id)?.displayName ?? id;
}

function weaponName(id: string): string {
  return GAMEPLAY_CONTENT_V2.weapons.find((weapon) => weapon.id === id)?.displayName ?? id;
}

function vehicleViews(): GarageVehicleViewV1[] {
  return GAMEPLAY_CONTENT_V2.vehicles.map((vehicle) => ({
    id: vehicle.id as GarageVehicleViewV1['id'],
    name: vehicle.displayName,
    role: vehicle.role,
    maxHp: vehicle.maxHp,
    armor: structuredClone(vehicle.armor),
    topSpeed: vehicle.mobility.maxSpeedPermille / 1000,
    vision: vehicle.vision.rangeCells,
    compatibleWeaponIds: [...vehicle.compatibleWeaponIds],
  }));
}

function weaponViews(): GarageWeaponViewV1[] {
  return GAMEPLAY_CONTENT_V2.weapons.map((weapon) => ({
    id: weapon.id as GarageWeaponViewV1['id'],
    name: weapon.displayName,
    damage: weapon.damage,
    penetration: weapon.penetration,
    range: weapon.rangeCells,
    reload: weapon.reloadTicks,
    ammunition: weapon.ammunitionCapacity,
  }));
}

function emptyRecord(): GarageBattleRecordV1 {
  return { wins: 0, losses: 0, draws: 0 };
}

async function atomicWrite(targetPath: string, text: string): Promise<void> {
  const directory = resolve(targetPath, '..');
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  const temporary = await open(temporaryPath, 'wx');
  try {
    await temporary.writeFile(text, 'utf8');
    await temporary.sync();
  } finally {
    await temporary.close();
  }
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
