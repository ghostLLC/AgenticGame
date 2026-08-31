import { createSavedBuildV2, type SavedBuildV2 } from '../config/saved-build-v2.js';

export type FriendRoomPresetIdV1 = 'scout' | 'medium' | 'heavy';

export interface FriendRoomPresetOptionV1 {
  id: FriendRoomPresetIdV1;
  label: string;
  vehicle: string;
  style: string;
}

const PRESETS: ReadonlyArray<FriendRoomPresetOptionV1> = [
  { id: 'scout', label: '游骑侦察队', vehicle: '侦察坦克', style: '机动侦察，主动寻找侧翼机会' },
  { id: 'medium', label: '中线突击队', vehicle: '中型坦克', style: '攻守均衡，持续向中心施压' },
  { id: 'heavy', label: '钢铁堡垒队', vehicle: '重型坦克', style: '正面推进，依靠装甲稳住阵线' },
];

export function friendRoomPresetOptionsV1(): FriendRoomPresetOptionV1[] {
  return PRESETS.map((item) => ({ ...item }));
}

export function createPresetBuildV1(
  presetId: FriendRoomPresetIdV1,
  createdAt: string,
  displayName?: string,
): SavedBuildV2 {
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error('请选择一套战术配置');
  const loadout = preset.id === 'scout'
    ? { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] as string[] }
    : preset.id === 'medium'
      ? { vehicleId: 'medium', weaponId: 'medium-cannon', equipmentIds: [] as string[] }
      : { vehicleId: 'heavy', weaponId: 'heavy-cannon', equipmentIds: [] as string[] };
  const behavior = preset.id === 'heavy'
    ? '{ throttle: 1, bodyTurn: 0, turretTurn: 0, fire: true }'
    : preset.id === 'medium'
      ? '{ throttle: 1, bodyTurn: 0, turretTurn: 1, fire: true }'
      : '{ throttle: 1, bodyTurn: 1, turretTurn: 0, fire: true }';
  const owner = displayName?.trim();
  return createSavedBuildV2({
    buildId: `friend-${preset.id}`,
    label: owner ? `${owner} · ${preset.label}` : preset.label,
    bot: {
      artifactId: `friend-${preset.id}-bot`,
      version: '1.0.0',
      language: 'javascript',
      entryPoint: `${preset.id}.js`,
      source: `module.exports = () => ({ onTick() { return ${behavior}; } });`,
    },
    loadout,
  }, { revision: 1, parentFingerprint: null, createdAt });
}
