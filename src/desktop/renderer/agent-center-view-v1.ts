import type { AgentCenterControllerSnapshotV1 } from './agent-center-controller-v1.js';

export function renderAgentCenterV1(snapshot: AgentCenterControllerSnapshotV1): void {
  const loading = snapshot.status === 'idle' || snapshot.status === 'loading';
  element('agent-loading').hidden = !loading;
  element('agent-workspace').hidden = loading || !snapshot.center;
  element('agent-running').hidden = snapshot.status !== 'running' && snapshot.status !== 'cancelling';
  element('agent-ready').hidden = snapshot.status !== 'ready';
  element('agent-result').hidden = !snapshot.result;
  element('agent-error').hidden = snapshot.status !== 'error';
  if (snapshot.error) element('agent-error').textContent = snapshot.error;
  element<HTMLButtonElement>('agent-run').disabled = snapshot.status === 'running' || snapshot.status === 'cancelling' || snapshot.status === 'saving';
  element<HTMLButtonElement>('agent-cancel').disabled = snapshot.status === 'cancelling';
  element<HTMLButtonElement>('agent-save').disabled = snapshot.status === 'saving' || snapshot.status === 'saved';

  if (snapshot.center) {
    replaceOptions('agent-build', snapshot.center.builds.map((build) => ({
      value: String(build.revision), text: `${build.label} · 第 ${build.revision} 版 · ${build.vehicleName} / ${build.weaponName}`,
    })));
    replaceOptions('agent-provider', snapshot.center.providerPresets.map((provider) => ({ value: provider.id, text: provider.name })));
  }
  if (snapshot.result) {
    const evaluation = snapshot.result.evaluation;
    element('agent-result-title').textContent = snapshot.result.status === 'cancelled' ? '已保留完成的评测' : '候选战术已完成评测';
    element('agent-result-summary').textContent = snapshot.result.coachSummary;
    element('agent-result-wins').textContent = `${evaluation.wins} 胜 · ${evaluation.draws} 平 · ${evaluation.losses} 负`;
    element('agent-result-hp').textContent = String(evaluation.averageRemainingHp);
    element('agent-result-violations').textContent = evaluation.violations === 0 && evaluation.runtimeErrors === 0
      ? '无异常'
      : `${evaluation.violations + evaluation.runtimeErrors} 次需关注`;
  }
  if (snapshot.status === 'saved' && snapshot.saved) {
    element('agent-result-title').textContent = `已保存为第 ${snapshot.saved.revision} 版`;
    element('agent-result-summary').textContent = `${snapshot.saved.label} 已进入你的车库，旧版本保持不变。`;
  }
}

function replaceOptions(id: string, options: Array<{ value: string; text: string }>): void {
  const select = element<HTMLSelectElement>(id);
  const previous = select.value;
  select.replaceChildren(...options.map((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.text;
    return option;
  }));
  if (options.some((item) => item.value === previous)) select.value = previous;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing agent center element: ${id}`);
  return value as T;
}
