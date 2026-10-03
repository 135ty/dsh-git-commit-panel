/**
 * dsh-git-commit-panel browser half.
 *
 * One registration into the frame-wide `shell.overlay` seat: the floating
 * commit pill and its expanded commit card. The seat is additive and
 * click-through, so the panel opts back into pointer events and never blocks
 * the application underneath.
 *
 * All git and model work goes through this package's own host half over
 * `/git-commit/*`; the browser never shells out and never imports another
 * plugin's runtime values.
 *
 * @module dsh-git-commit-panel/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { RepoStatus } from '../types.ts';
import { type GitCommitPanelKey } from './locales.ts';
export type { GitCommitPanelKey } from './locales.ts';
export type { PanelProps, GitCommitStatusHook } from './Panel.tsx';
export { Panel } from './Panel.tsx';
export { GitCommitApi, ROUTE_PREFIX } from './api.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The floating commit panel's copy. */
        gitCommitPanel: GitCommitPanelKey;
    }
    interface GlobalStandardProps {
        /** Selector hook over the picked workspace's repository status; absent while none is picked. */
        useGitCommitStatus: SnapshotSelectorHook<RepoStatus | null | undefined>;
    }
}
/** Services this half needs: the slot registry, the dictionary registry, and the client session/workspace lists. */
export declare const inject: string[];
/**
 * Client plugin body: publish the status source, then register the panel into
 * the frame's overlay seat.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
