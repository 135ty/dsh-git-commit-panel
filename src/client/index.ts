/**
 * dsh-git-commit-panel browser half.
 *
 * One registration into the frame-wide `shell.overlay` seat: the floating
 * commit pill and its expanded commit card, both scoped to the workspace of the
 * conversation the main view is showing. The seat is additive and
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
// Type-only: installs ctx.slots (the renderer owns the slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
// Type-only: installs ctx.locale and the renderer's locale face contract.
import type {} from '@deepseek-ai/dsh-client-locale/client';
// Type-only: installs the `shell.overlay` declaration merge (ui-layout's AppFrame).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
// Type-only: installs `ctx.sessions` and the session standard seats.
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { RepoStatus } from '../types.ts';
import { GitCommitApi } from './api.ts';
import { en, NS, zh, type GitCommitPanelKey } from './locales.ts';
import { Panel, type PanelProps } from './Panel.tsx';

export type { GitCommitPanelKey } from './locales.ts';
export type { PanelProps, GitCommitStatusHook } from './Panel.tsx';
export { Panel } from './Panel.tsx';
export { GitCommitApi, ROUTE_PREFIX } from './api.ts';

/** The seat this plugin occupies; additive list entries never replace the frame. */
const SLOT = 'shell.overlay';

/** Name of the one root source this plugin publishes. */
const STATUS_SOURCE = 'gitCommitStatus';

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

/** Services this half needs: the slot registry, the dictionary registry, and the client session list. */
export const inject = ['slots', 'locale', 'sessions'];

/**
 * Client plugin body: publish the status source, then register the panel into
 * the frame's overlay seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-git-commit-panel: dictionaries');

  const git = new GitCommitApi();

  // One shell-lifetime source holding the repository status the panel shows.
  // The panel occurrence writes it; components read it through the injected
  // selector hook, and a snapshot never changes identity without notifying.
  let snapshot: RepoStatus | null = null;
  const listeners = new Set<() => void>();
  const source: HostObservable<RepoStatus | null> = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const publish = (next: RepoStatus | null): void => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  // The status source is a shell-wide seat, so it is installed once when the
  // slot registry is ready rather than by any one occurrence.
  ctx.slots.inject(SLOT, () => ctx.slots.provideRoot({
    hooks: { [STATUS_SOURCE]: source as HostObservable<unknown> },
  }));

  const Component = (props: PanelProps) => Panel({ ...props, git, setStatus: publish });

  ctx.slots.inject(SLOT, () => {
    const entry = {
      name: SLOT,
      id: 'git-commit-panel',
      order: 50,
      locale: NS,
    } as unknown as Parameters<typeof ctx.slots.register>[0];
    const component = Component as unknown as Parameters<typeof ctx.slots.register>[1];
    return ctx.slots.register(entry, component);
  });
}
