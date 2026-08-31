import type { DesktopAppShellSnapshotV1 } from './app-shell-controller-v1.js';

export function renderAppShellV1(snapshot: DesktopAppShellSnapshotV1): void {
  const command = element<HTMLElement>('page-command-center');
  const friend = element<HTMLElement>('page-friend-room');
  const commandNav = element<HTMLButtonElement>('nav-command-center');
  const friendNav = element<HTMLButtonElement>('nav-friend-room');
  const onCommand = snapshot.page === 'command-center';
  command.hidden = !onCommand;
  friend.hidden = onCommand;
  commandNav.classList.toggle('active', onCommand);
  friendNav.classList.toggle('active', !onCommand);
  commandNav.toggleAttribute('aria-current', onCommand);
  friendNav.toggleAttribute('aria-current', !onCommand);
  element<HTMLElement>('connection-pill').hidden = onCommand;
  element<HTMLElement>('app-breadcrumb').innerHTML = onCommand
    ? '指挥中心 <b>/</b> 作战总览'
    : '好友房间 <b>/</b> 连接大厅';
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
