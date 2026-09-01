import type { DesktopAppShellSnapshotV1 } from './app-shell-controller-v1.js';

export function renderAppShellV1(snapshot: DesktopAppShellSnapshotV1): void {
  const pages = ['command-center', 'garage', 'practice', 'friend-room', 'replays', 'agent-center'] as const;
  for (const page of pages) {
    const active = snapshot.page === page;
    element<HTMLElement>(`page-${page}`).hidden = !active;
    const navigation = element<HTMLButtonElement>(`nav-${page}`);
    navigation.classList.toggle('active', active);
    navigation.toggleAttribute('aria-current', active);
  }
  element<HTMLElement>('connection-pill').hidden = snapshot.page !== 'friend-room';
  const breadcrumbs = {
    'command-center': ['指挥中心', '作战总览'],
    garage: ['我的车库', '战车整备'],
    practice: ['战术实验室', '训练编组'],
    'friend-room': ['好友房间', '连接大厅'],
    replays: ['回放工作室', '战报收藏'],
    'agent-center': ['AI 战术教练', '协同改进'],
  } as const;
  const [area, detail] = breadcrumbs[snapshot.page as keyof typeof breadcrumbs] ?? breadcrumbs['command-center'];
  const breadcrumb = element<HTMLElement>('app-breadcrumb');
  breadcrumb.replaceChildren(document.createTextNode(`${area} `));
  const divider = document.createElement('b');
  divider.textContent = '/';
  breadcrumb.append(divider, document.createTextNode(` ${detail}`));
  if (snapshot.profile) {
    element<HTMLElement>('commander-welcome').textContent = `欢迎回来，${snapshot.profile.displayName}`;
    const host = element<HTMLInputElement>('host-name');
    const guest = element<HTMLInputElement>('guest-name');
    if (!host.value) host.value = snapshot.profile.displayName;
    if (!guest.value) guest.value = snapshot.profile.displayName;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing app shell element: ${id}`);
  return value as T;
}
