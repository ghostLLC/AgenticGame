import type { FriendRoomBrowserConnectionStateV1 } from '../friend-room/browser-connection-v1.js';

export interface DesktopBrowserWindowOptionsV1 {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  backgroundColor: string;
  autoHideMenuBar: boolean;
  title: string;
  icon: string;
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
  };
}

export interface FriendRoomPlayerStatusV1 {
  eyebrow: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'waiting' | 'success' | 'danger';
}

export function createDesktopBrowserWindowOptionsV1(preload: string, icon: string): DesktopBrowserWindowOptionsV1 {
  return {
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#1a1614',
    autoHideMenuBar: true,
    title: 'AgenticGame · 坦克竞技场',
    icon,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

const PLAYER_STATUS: Record<FriendRoomBrowserConnectionStateV1, FriendRoomPlayerStatusV1> = {
  idle: {
    eyebrow: '好友房间',
    title: '带上你的战车，与好友开战',
    detail: '创建邀请或接受朋友的邀请，即可进入好友房间。',
    tone: 'neutral',
  },
  gathering: {
    eyebrow: '正在准备邀请',
    title: '马上就好',
    detail: '游戏正在准备安全连接，请稍候。',
    tone: 'waiting',
  },
  'waiting-answer': {
    eyebrow: '邀请卡已生成',
    title: '等待朋友回应',
    detail: '把邀请卡发给朋友，收到加入确认后粘贴回来。',
    tone: 'waiting',
  },
  'waiting-host': {
    eyebrow: '已确认加入',
    title: '等待房主接收',
    detail: '把加入确认发回房主，并保持游戏在线。',
    tone: 'waiting',
  },
  connecting: {
    eyebrow: '正在会合',
    title: '正在连接好友',
    detail: '请保持双方游戏在线。',
    tone: 'waiting',
  },
  connected: {
    eyebrow: '好友已连接',
    title: '可以进入战前准备',
    detail: '双方的战术配置会在房间内自动同步。',
    tone: 'success',
  },
  disconnected: {
    eyebrow: '好友暂时离线',
    title: '重新与好友会合',
    detail: '房间仍然保留，房主可以生成新的会合邀请。',
    tone: 'danger',
  },
  failed: {
    eyebrow: '未能连接',
    title: '请重新邀请好友',
    detail: '检查双方是否在线，然后重新创建好友房间。',
    tone: 'danger',
  },
};

export function friendRoomPlayerStatusV1(state: FriendRoomBrowserConnectionStateV1): FriendRoomPlayerStatusV1 {
  return PLAYER_STATUS[state];
}
