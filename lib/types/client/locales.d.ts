/**
 * Copy for the floating commit panel, in English and Chinese.
 *
 * @module dsh-git-commit-panel/client/locales
 */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "gitCommitPanel";
/** The English dictionary; its keys are the namespace's key domain. */
export declare const en: {
    readonly badgeTitle: "Commit changes";
    readonly badgeFiles: "{count} changed";
    readonly title: "Commit changes";
    readonly close: "Close";
    readonly refresh: "Refresh";
    readonly branch: "Branch";
    readonly detached: "detached HEAD";
    readonly upstreamAheadBehind: "↑{ahead} ↓{behind}";
    readonly fileCount: "{total} changed · {staged} staged · {unstaged} unstaged";
    readonly messageLabel: "Commit message";
    readonly messagePlaceholder: "feat: describe the change";
    readonly hintLabel: "Context for the AI (optional)";
    readonly hintPlaceholder: "Anything the diff does not show?";
    readonly generate: "Generate with AI";
    readonly generating: "Generating…";
    readonly commit: "Commit";
    readonly commitAndPush: "Commit & Push";
    readonly committing: "Committing…";
    readonly pushing: "Pushing…";
    readonly stageAll: "Stage all changes before committing";
    readonly stageAllHint: "Includes untracked files.";
    readonly commitStagedOnly: "Only already-staged changes will be committed.";
    readonly noUnstaged: "No unstaged changes in this workspace.";
    readonly noStaged: "Nothing is staged yet.";
    readonly repository: "Repository";
    readonly workspace: "Workspace";
    readonly emptyMessage: "Write a commit message, or let the AI draft one.";
    readonly generateFailed: "Could not generate a commit message.";
    readonly commitFailed: "Commit failed.";
    readonly showFiles: "Show changed files";
    readonly hideFiles: "Hide changed files";
    readonly commits: "Commit";
    readonly andPush: "and push";
};
/** The Chinese dictionary; every English key must be present. */
export declare const zh: Record<keyof typeof en, string>;
/** Dictionary key domain, used to type the registrant's `t` seat. */
export type GitCommitPanelKey = keyof typeof en;
