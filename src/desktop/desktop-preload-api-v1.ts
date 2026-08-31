import type { DesktopApiV1 } from './desktop-api-v1.js';

export type DesktopInvokeV1 = (channel: string, input?: unknown) => Promise<unknown>;

export function createDesktopPreloadApiV1(invoke: DesktopInvokeV1): DesktopApiV1 {
  return {
    app: {
      bootstrap: () => invoke('app:bootstrap') as ReturnType<DesktopApiV1['app']['bootstrap']>,
    },
    profile: {
      create: (input) => invoke('profile:create', input) as ReturnType<DesktopApiV1['profile']['create']>,
      advanceTutorial: (stage) => invoke('profile:advance-tutorial', stage) as ReturnType<DesktopApiV1['profile']['advanceTutorial']>,
    },
    navigation: {
      remember: (page) => invoke('navigation:remember', page) as ReturnType<DesktopApiV1['navigation']['remember']>,
    },
    tutorial: {
      run: () => invoke('tutorial:run') as ReturnType<DesktopApiV1['tutorial']['run']>,
    },
  };
}
