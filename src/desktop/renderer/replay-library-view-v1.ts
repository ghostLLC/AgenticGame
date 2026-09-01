import type { ReplayLibraryControllerSnapshotV1 } from './replay-library-controller-v1.js';

export function renderReplayLibraryV1(snapshot: ReplayLibraryControllerSnapshotV1): void {
  element('replay-library-loading').hidden = snapshot.status !== 'loading' && snapshot.status !== 'idle';
  element('replay-library-empty').hidden = snapshot.status === 'loading' || snapshot.cards.length > 0 || snapshot.counts.all > 0;
  element('replay-library-content').hidden = snapshot.status === 'loading' || snapshot.counts.all === 0;
  element('replay-library-damaged').hidden = snapshot.counts.damaged === 0;
  element('replay-damaged-copy').textContent = `${snapshot.counts.damaged} 场回放需要整理；健康回放不受影响。`;
  element('replay-library-total').textContent = `${snapshot.counts.all} 场战斗`;
  element('replay-count-practice').textContent = String(snapshot.counts.practice);
  element('replay-count-friend').textContent = String(snapshot.counts.friendPublic);
  element('replay-count-damaged').textContent = String(snapshot.counts.damaged);
  const cards = element('replay-library-cards');
  cards.replaceChildren(...snapshot.cards.map((card) => {
    const article = document.createElement('article');
    article.className = 'replay-library-card';
    article.dataset.integrity = card.integrity;
    article.dataset.replayId = card.replayId;
    article.dataset.source = card.source;
    const top = document.createElement('div');
    top.className = 'replay-card-top';
    top.append(textNode('span', card.source === 'practice' ? '练习赛' : '好友对战'), textNode('time', formatDate(card.createdAt)));
    const title = textNode('h3', card.integrity === 'damaged' ? '这场回放需要整理' : card.modeName);
    const participants = textNode('p', card.participantNames.join('  vs  '));
    const result = document.createElement('div');
    result.className = 'replay-card-result';
    result.append(textNode('b', outcomeName(card.outcome)), textNode('span', `${card.ticks} 回合`));
    const note = document.createElement('textarea');
    note.className = 'replay-note-input';
    note.maxLength = 240;
    note.value = card.note;
    note.placeholder = '写下这场战斗的复盘心得';
    note.setAttribute('aria-label', '复盘笔记');
    const actions = document.createElement('div');
    actions.className = 'replay-card-actions';
    if (card.playable) actions.append(action('打开回放', 'open'), action('保存复盘笔记', 'note'), action('保存回放文件', 'export'));
    actions.append(action('移到回收站', 'trash'));
    article.append(top, title, participants, result, note, actions);
    return article;
  }));
  renderTrash(snapshot);
}

function renderTrash(snapshot: ReplayLibraryControllerSnapshotV1): void {
  const list = element('replay-trash-list');
  if (snapshot.trash.length === 0) {
    const empty = textNode('p', '回收站是空的。');
    empty.className = 'muted-copy';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...snapshot.trash.map((entry) => {
    const row = document.createElement('article');
    row.className = 'replay-trash-item';
    row.dataset.entryId = entry.entryId;
    const copy = document.createElement('div');
    copy.append(textNode('b', entry.source === 'practice' ? '练习赛回放' : '好友对战回放'), textNode('span', entry.note || `移入时间：${formatDate(entry.deletedAt)}`));
    const restore = action('恢复回放', 'restore');
    row.append(copy, restore);
    return row;
  }));
}

function action(label: string, name: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = name === 'open' ? 'primary-button' : 'secondary-button';
  button.dataset.replayAction = name;
  button.textContent = label;
  return button;
}

function textNode<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function outcomeName(value: string): string {
  return value === 'victory' ? '胜利' : value === 'defeat' ? '失利' : '平局';
}

function formatDate(value: string): string {
  if (value.startsWith('1970-')) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing replay library element: ${id}`);
  return value;
}
