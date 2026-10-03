/**
 * Copy for the floating commit panel, in English and Chinese.
 *
 * @module dsh-git-commit-panel/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'gitCommitPanel';

/** The English dictionary; its keys are the namespace's key domain. */
export const en = {
  badgeTitle: 'Commit changes',
  badgeFiles: '{count} changed',
  title: 'Commit changes',
  close: 'Close',
  refresh: 'Refresh',
  branch: 'Branch',
  detached: 'detached HEAD',
  upstreamAheadBehind: '↑{ahead} ↓{behind}',
  fileCount: '{total} changed · {staged} staged · {unstaged} unstaged',
  messageLabel: 'Commit message',
  messagePlaceholder: 'feat: describe the change',
  hintLabel: 'Context for the AI (optional)',
  hintPlaceholder: 'Anything the diff does not show?',
  generate: 'Generate with AI',
  generating: 'Generating…',
  commit: 'Commit',
  commitAndPush: 'Commit & Push',
  committing: 'Committing…',
  pushing: 'Pushing…',
  stageAll: 'Stage all changes before committing',
  stageAllHint: 'Includes untracked files.',
  commitStagedOnly: 'Only already-staged changes will be committed.',
  noUnstaged: 'No unstaged changes in this workspace.',
  noStaged: 'Nothing is staged yet.',
  repository: 'Repository',
  workspace: 'Workspace',
  generateFailed: 'Could not generate a commit message.',
  commitFailed: 'Commit failed.',
  showFiles: 'Show changed files',
  hideFiles: 'Hide changed files',
  commits: 'Commit',
  andPush: 'and push',
  emptyGenerates: 'Leave the message empty and the AI drafts one, then commits.',
  generatedBy: 'Drafted by {model}',
} as const;

/** The Chinese dictionary; every English key must be present. */
export const zh: Record<keyof typeof en, string> = {
  badgeTitle: '提交更改',
  badgeFiles: '{count} 个更改',
  title: '提交更改',
  close: '关闭',
  refresh: '刷新',
  branch: '分支',
  detached: '游离 HEAD',
  upstreamAheadBehind: '↑{ahead} ↓{behind}',
  fileCount: '共 {total} 个更改 · 已暂存 {staged} · 未暂存 {unstaged}',
  messageLabel: '提交信息',
  messagePlaceholder: 'feat: 描述本次改动',
  hintLabel: '给 AI 的补充说明（可选）',
  hintPlaceholder: 'diff 里看不出来的意图？',
  generate: 'AI 生成',
  generating: '生成中…',
  commit: '提交',
  commitAndPush: '提交并推送',
  committing: '提交中…',
  pushing: '推送中…',
  stageAll: '提交前暂存全部更改',
  stageAllHint: '包含未跟踪的文件。',
  commitStagedOnly: '只会提交已暂存的更改。',
  noUnstaged: '该工作区没有未暂存的更改。',
  noStaged: '当前没有已暂存的更改。',
  repository: '仓库',
  workspace: '工作区',
  generateFailed: '无法生成提交信息。',
  commitFailed: '提交失败。',
  showFiles: '展开更改文件',
  hideFiles: '收起更改文件',
  commits: '提交',
  andPush: '并推送',
  emptyGenerates: '留空则由 AI 起草提交信息并直接提交。',
  generatedBy: '由 {model} 起草',
};

/** Dictionary key domain, used to type the registrant's `t` seat. */
export type GitCommitPanelKey = keyof typeof en;
