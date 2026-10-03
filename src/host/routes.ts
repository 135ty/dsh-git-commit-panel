/**
 * `/git-commit/*` route layer: a loopback-fenced JSON endpoint family over the
 * {@link GitCommitService}. This layer owns HTTP shape only — request
 * narrowing, the ok/error envelope, and the response guards; every git and
 * model decision belongs to the service.
 *
 * @module dsh-git-commit-panel/host/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import {
  isCommitResult,
  isDiffPayload,
  isGenerateMessageResult,
  isRepoStatus,
  readCommitRequest,
  readDiffRequest,
  readGenerateRequest,
  readStatusRequest,
  type Envelope,
  type GitCommitError,
} from '../types.ts';
import { ServiceError, toWireError, type GitCommitService } from './service.ts';

/** Absolute route prefix owned by this plugin; nothing else may claim it. */
export const ROUTE_PREFIX = '/git-commit';

/** Request-body cap: large enough for a diff request plus a commit message. */
const BODY_MAX_BYTES = 1024 * 1024;

const OK = (value: unknown): Envelope<unknown> => ({ ok: true, value });

/** Read a bounded JSON body; null when absent, malformed, or oversized. */
async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > BODY_MAX_BYTES) {
      req.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Write one JSON envelope. */
function writeJson(res: ServerResponse, status: number, body: Envelope<unknown>): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

/** Write one handled failure. */
function writeFailure(res: ServerResponse, error: unknown): void {
  const wire: GitCommitError = toWireError(error);
  if (wire.code === 'internal') {
    const detail = wire.detail ?? '';
    console.error(`[dsh-git-commit-panel] route failure: ${wire.message}${detail === '' ? '' : ` — ${detail}`}`);
  }
  writeJson(res, 200, { ok: false, error: wire });
}

/**
 * Whether a request may enter any route: loopback socket, loopback Host
 * header, and same-origin browser markers. Remote/tunnel deployments do not
 * inherit this plugin's write access.
 * @param req - the incoming request.
 * @returns true for a trustworthy local request.
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  const normalized = address.toLowerCase();
  const loopback = normalized === '::1'
    || normalized.startsWith('::ffff:127.')
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
  if (!loopback) return false;

  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  const loopbackHost = hostname === 'localhost'
    || hostname === '[::1]'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (!loopbackHost) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;

  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Register the plugin's HTTP routes.
 * @param ctx - context carrying the web server service.
 * @param service - the mounted git service.
 * @returns the single prefix-route disposer.
 */
export function registerGitCommitRoutes(ctx: Context, service: GitCommitService): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isTrustedRequest(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'bad-request', message: 'forbidden: local requests only' } });
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    // CSRF hardening: the commit leg mutates a real repository, so require a
    // JSON content-type. A cross-site form cannot set it without a CORS
    // preflight, which the same-origin client always satisfies.
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      res.writeHead(415);
      res.end();
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'malformed request path' } });
      return;
    }

    const payload = await readJsonBody(req);
    if (payload === null) {
      writeJson(res, 200, { ok: false, error: { code: 'bad-request', message: 'malformed JSON body' } });
      return;
    }

    try {
      switch (pathname) {
        case `${ROUTE_PREFIX}/status`: {
          const request = readStatusRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: 'bad-request', message: 'a workspace path is required' } });
          const status = await service.status(request);
          if (status === null) {
            writeJson(res, 200, OK(null));
            return;
          }
          writeJson(res, 200, isRepoStatus(status)
            ? OK(status)
            : { ok: false, error: { code: 'internal', message: 'malformed status payload' } });
          return;
        }
        case `${ROUTE_PREFIX}/diff`: {
          const request = readDiffRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: 'bad-request', message: 'a workspace path is required' } });
          const diff = await service.diff(request);
          writeJson(res, 200, isDiffPayload(diff)
            ? OK(diff)
            : { ok: false, error: { code: 'internal', message: 'malformed diff payload' } });
          return;
        }
        case `${ROUTE_PREFIX}/generate`: {
          const request = readGenerateRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: 'bad-request', message: 'a workspace path is required' } });
          const generated = await service.generateCommitMessage(request);
          writeJson(res, 200, isGenerateMessageResult(generated)
            ? OK(generated)
            : { ok: false, error: { code: 'internal', message: 'malformed generation payload' } });
          return;
        }
        case `${ROUTE_PREFIX}/commit`: {
          const request = readCommitRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: 'bad-request', message: 'a workspace path and a commit message are required' } });
          const result = await service.commit(request);
          writeJson(res, 200, isCommitResult(result)
            ? OK(result)
            : { ok: false, error: { code: 'internal', message: 'malformed commit payload' } });
          return;
        }
        default:
          writeJson(res, 404, { ok: false, error: { code: 'bad-request', message: 'unknown route' } });
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        writeFailure(res, error);
        return;
      }
      writeFailure(res, error);
    }
  };

  return ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
}
