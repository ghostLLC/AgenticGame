import type { GarageSnapshotV1 } from '../garage-service-v1.js';
import type { ReplayLibrarySnapshotV1 } from '../replay-library-service-v1.js';
import { tankIllustrationV1 } from './tank-illustration-v1.js';

export function renderCommandCenterV1(garage: GarageSnapshotV1, library: ReplayLibrarySnapshotV1): void {
  const current = garage.revisions.find((revision) => revision.revision === garage.currentRevision);
  const vehicle = garage.vehicles.find((item) => item.name === current?.vehicleName);
  const figure = document.getElementById('command-tank')!;
  figure.replaceChildren(tankIllustrationV1(vehicle?.id ?? 'medium', current?.vehicleName ?? '战车'));
  document.getElementById('command-build-title')!.textContent = current ? `${current.label} · r${current.revision}` : '准备你的第一辆战车';
  document.getElementById('command-build-detail')!.textContent = current ? `${current.vehicleName} / ${current.weaponName} / ${current.tacticName}` : '前往车库保存战术配置';
  document.getElementById('command-build-stats')!.textContent = vehicle ? `${vehicle.maxHp} 耐久　·　${vehicle.topSpeed} 格/回合　·　${vehicle.vision} 格视野` : '';
  const latest = library.cards[0];
  document.getElementById('command-recent-title')!.textContent = latest ? `${latest.modeName} · ${latest.outcome === 'victory' ? '胜利' : latest.outcome === 'defeat' ? '失利' : '平局'}` : '还没有完成的比赛';
  document.getElementById('command-recent-detail')!.textContent = latest
    ? `${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(latest.createdAt))} · ${latest.participantNames.join(' vs ')} · ${latest.ticks} 回合`
    : '开始一次镜像训练，观察当前战术的行动，再尝试下一次调整。';
}
