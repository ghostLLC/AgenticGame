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
    garage: {
      get: () => invoke('garage:get') as ReturnType<DesktopApiV1['garage']['get']>,
      save: (input) => invoke('garage:save', input) as ReturnType<DesktopApiV1['garage']['save']>,
      quarantine: () => invoke('garage:quarantine') as ReturnType<DesktopApiV1['garage']['quarantine']>,
      exportDiagnostic: () => invoke('garage:export-diagnostic') as ReturnType<DesktopApiV1['garage']['exportDiagnostic']>,
    },
    practice: {
      run: (input) => invoke('practice:run', input) as ReturnType<DesktopApiV1['practice']['run']>,
    },
    replays: {
      list: (filter) => invoke('replays:list', filter) as ReturnType<DesktopApiV1['replays']['list']>,
      open: (input) => invoke('replays:open', input) as ReturnType<DesktopApiV1['replays']['open']>,
      note: (input) => invoke('replays:note', input) as ReturnType<DesktopApiV1['replays']['note']>,
      export: (input) => invoke('replays:export', input) as ReturnType<DesktopApiV1['replays']['export']>,
      moveToTrash: (input) => invoke('replays:move-to-trash', input) as ReturnType<DesktopApiV1['replays']['moveToTrash']>,
      listTrash: () => invoke('replays:list-trash') as ReturnType<DesktopApiV1['replays']['listTrash']>,
      restore: (entryId) => invoke('replays:restore', entryId) as ReturnType<DesktopApiV1['replays']['restore']>,
      emptyTrash: (confirmed) => invoke('replays:empty-trash', confirmed) as ReturnType<DesktopApiV1['replays']['emptyTrash']>,
      exportDiagnostic: () => invoke('replays:export-diagnostic') as ReturnType<DesktopApiV1['replays']['exportDiagnostic']>,
    },
    agentCenter: {
      get: () => invoke('agent-center:get') as ReturnType<DesktopApiV1['agentCenter']['get']>,
      run: (input) => invoke('agent-center:run', input) as ReturnType<DesktopApiV1['agentCenter']['run']>,
      cancel: () => invoke('agent-center:cancel') as ReturnType<DesktopApiV1['agentCenter']['cancel']>,
      save: (input) => invoke('agent-center:save', input) as ReturnType<DesktopApiV1['agentCenter']['save']>,
    },
  };
}
