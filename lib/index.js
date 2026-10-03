/**
 * dsh-git-commit-panel host half.
 *
 * The floating commit panel itself lives in the browser half
 * (`exports["./client"]`, served by the client-modules plugin graph). This
 * half owns everything the browser must not do itself: canonical workspace
 * gating, the git verbs (`status` / `diff` / `commit` / `push`), and the AI
 * commit-message call against the deployment's default model.
 *
 * `webServer` is required because the browser half talks to this half over
 * HTTP. The route registration is the fiber's effect, so unloading the plugin
 * removes the routes with it.
 *
 * @module dsh-git-commit-panel
 */
import { createWorkspaceGate, GitCommitService } from "./host/service.js";
import { registerGitCommitRoutes } from "./host/routes.js";
/** Stable Loader identity. */
export const name = 'dsh-git-commit-panel';
/**
 * Required services: the HTTP carrier, the managed subprocess seam, the
 * default-model selector for AI commit messages, and the workspace registry
 * that defines the legal git targets.
 */
export const inject = ['webServer', 'subprocess', 'agentDefaultModel', 'workspaceRegistry'];
/**
 * Mount the git service and its routes.
 * @param ctx - host context carrying the injected services.
 */
export function apply(ctx) {
    const service = new GitCommitService(ctx, { gate: createWorkspaceGate(ctx) });
    ctx.effect(() => registerGitCommitRoutes(ctx, service), 'dsh-git-commit-panel: /git-commit routes');
}
