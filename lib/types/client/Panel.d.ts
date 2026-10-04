import type { ReactElement } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { RepoStatus } from '../types.ts';
import type { GitCommitApi } from './api.ts';
/** Selector hook over the picked workspace's repository status. */
export type GitCommitStatusHook = SnapshotSelectorHook<RepoStatus | null | undefined>;
/** Props of one registered panel occurrence: locale seat + injected business face. */
export interface PanelProps extends PropsLocale<'gitCommitPanel'> {
    /** Wire client for the host's `/git-commit/*` routes. */
    git: GitCommitApi;
    /** Selector hook over the shared status source. */
    useGitCommitStatus: GitCommitStatusHook;
    /** Write the shared status source. */
    setStatus: (status: RepoStatus | null) => void;
    /** Selector hook over the client session list (global standard seat). */
    useSessions: SnapshotSelectorHook<SessionListState>;
}
/**
 * One occurrence of the floating commit panel.
 * @param props - composed slot props (locale seat + injected business face).
 * @returns the pill while the conversation's workspace has changes, otherwise nothing.
 */
export declare function Panel(props: PanelProps): ReactElement | null;
