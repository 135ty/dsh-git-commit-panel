/**
 * `/git-commit/*` route layer: a loopback-fenced JSON endpoint family over the
 * {@link GitCommitService}. This layer owns HTTP shape only — request
 * narrowing, the ok/error envelope, and the response guards; every git and
 * model decision belongs to the service.
 *
 * @module dsh-git-commit-panel/host/routes
 */
import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type GitCommitService } from './service.ts';
/** Absolute route prefix owned by this plugin; nothing else may claim it. */
export declare const ROUTE_PREFIX = "/git-commit";
/**
 * Whether a request may enter any route: loopback socket, loopback Host
 * header, and same-origin browser markers. Remote/tunnel deployments do not
 * inherit this plugin's write access.
 * @param req - the incoming request.
 * @returns true for a trustworthy local request.
 */
export declare function isTrustedRequest(req: IncomingMessage): boolean;
/**
 * Register the plugin's HTTP routes.
 * @param ctx - context carrying the web server service.
 * @param service - the mounted git service.
 * @returns the single prefix-route disposer.
 */
export declare function registerGitCommitRoutes(ctx: Context, service: GitCommitService): () => void;
