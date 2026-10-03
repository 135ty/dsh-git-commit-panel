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
import type { Context } from '@deepseek-ai/cordis';
/** Stable Loader identity. */
export declare const name = "dsh-git-commit-panel";
/**
 * Required services: the HTTP carrier, the managed subprocess seam, the model
 * runtime and its default selection for AI commit messages, and the workspace
 * registry that defines the legal git targets.
 */
export declare const inject: string[];
/**
 * Mount the git service and its routes.
 * @param ctx - host context carrying the injected services.
 */
export declare function apply(ctx: Context): void;
