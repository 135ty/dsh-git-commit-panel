import { GitCommitApi } from "./api.js";
import { en, NS, zh } from "./locales.js";
import { Panel } from "./Panel.js";
export { Panel } from "./Panel.js";
export { GitCommitApi, ROUTE_PREFIX } from "./api.js";
/** The seat this plugin occupies; additive list entries never replace the frame. */
const SLOT = 'shell.overlay';
/** Name of the one root source this plugin publishes. */
const STATUS_SOURCE = 'gitCommitStatus';
/** Services this half needs: the slot registry, the dictionary registry, and the client session/workspace lists. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces'];
/**
 * Client plugin body: publish the status source, then register the panel into
 * the frame's overlay seat.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-git-commit-panel: dictionaries');
    const git = new GitCommitApi();
    // One shell-lifetime source holding the repository status the panel shows.
    // The panel occurrence writes it; components read it through the injected
    // selector hook, and a snapshot never changes identity without notifying.
    let snapshot = null;
    const listeners = new Set();
    const source = {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
    const publish = (next) => {
        if (next === snapshot)
            return;
        snapshot = next;
        for (const listener of [...listeners])
            listener();
    };
    // The status source is a shell-wide seat, so it is installed once when the
    // slot registry is ready rather than by any one occurrence.
    ctx.slots.inject(SLOT, () => ctx.slots.provideRoot({
        hooks: { [STATUS_SOURCE]: source },
    }));
    const Component = (props) => Panel({ ...props, git, setStatus: publish });
    ctx.slots.inject(SLOT, () => {
        const entry = {
            name: SLOT,
            id: 'git-commit-panel',
            order: 50,
            locale: NS,
        };
        const component = Component;
        return ctx.slots.register(entry, component);
    });
}
