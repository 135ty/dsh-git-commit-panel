/**
 * The floating commit panel. Rendered into the frame-wide `shell.overlay`
 * seat, it shows a small pill while the conversation the main view is showing
 * sits in a workspace with work-tree changes, and expands into a commit card:
 * changed-file list, a message box that the user can write or have the host's
 * model draft, and the two commit actions.
 *
 * The component is deliberately data-poor: it receives the standard
 * `useSessions` seat and one injected status hook, and every git or model
 * decision happens in the host half through {@link GitCommitApi}.
 *
 * @module dsh-git-commit-panel/client/Panel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
// Type-only: pulls the framework standard-prop declaration merge
// (`useSessions`) into this program. It is erased at build time and creates no
// bundle request.
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { CommitResult, FileChange, GitCommitError, RepoStatus } from '../types.ts';import type { GitCommitApi } from './api.ts';

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

const POLL_INTERVAL_MS = 20_000;
const SCAN_MIN_INTERVAL_MS = 3_000;

/** Colour-carrying change-kind glyph. */
const KIND_MARK: Record<FileChange['kind'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unmerged: 'U',
  untracked: '?',
};

/**
 * Top offset of the panel's seat, measured down the frame's right edge. It is a
 * constant of this plugin: nothing is measured at runtime.
 *
 * The number clears the band a floating status capsule occupies in the frame's
 * top-right corner. Measured on a 1920-wide window that band runs 82–130px,
 * because such a capsule wraps its label onto two lines there (33px tall when
 * it fits on one), so 144 leaves a 14px gap under the widest case observed
 * rather than the 8px a taller capsule would swallow. A deployment with no such
 * plugin still seats the pill in the frame's upper right.
 *
 * `--dsh-frame-top-clearance` is the shell's own reserved top strip (zero in a
 * browser tab, the title bar height in the desktop shell), so the seat moves
 * with the frame exactly as the shell does.
 */
const PANEL_TOP_PX = 144;

/**
 * The panel's one seat: the frame's own top-right corner, inside the shell's
 * overlay layer. The position is a constant of this plugin — it is never
 * measured against, or derived from, any other plugin's DOM, so a deployment
 * that mounts no floating capsule of any kind still places the pill exactly
 * here, and one that mounts two of them cannot move it.
 *
 * Surface styles. Every value comes from the theme's own token table
 * (`dsh-client-ui-theme`) and follows the composition its shipped surfaces
 * use: layer-2 panel + `elevation-prominent` (settings panel), floating
 * button fill for the pill, `.5px` borders at `border-l2`/`border-l4`,
 * `radius-panel`/`radius-lg`/`radius-sm`, and the `font-xs-13` typography.
 * No literal colour appears here, so the panel follows light/dark/system
 * without its own theme handling.
 */
const panelRootBase: CSSProperties = {
  position: 'absolute',
  top: `calc(var(--dsh-frame-top-clearance, 0px) + ${PANEL_TOP_PX}px)`,
  right: 14,
  pointerEvents: 'auto',
};

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 'min(420px, calc(100vw - 40px))',
  padding: 16,
  borderRadius: 'var(--dsw-radius-panel)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: 'var(--dsw-elevation-prominent)',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsw-font-xs-13-font-size)',
  lineHeight: 'var(--dsw-font-xs-13-line-height)',
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 14px',
  borderRadius: 'var(--dsw-radius-panel)',
  cursor: 'pointer',
  background: 'var(--dsw-alias-button-floating-fill)',
  color: 'var(--dsw-alias-label-primary)',
  border: '.5px solid var(--dsw-alias-border-l2)',
  boxShadow: 'var(--dsw-elevation-panel)',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsw-font-xs-13-font-size)',
  lineHeight: 'var(--dsw-font-xs-13-line-height)',
};

const buttonBase: CSSProperties = {
  boxSizing: 'border-box',
  height: 28,
  padding: '0 12px',
  borderRadius: 'var(--dsw-radius-sm)',
  cursor: 'pointer',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsw-font-xs-13-font-size)',
  lineHeight: 'var(--dsw-font-xs-13-line-height)',
  fontWeight: 'var(--dsw-font-xs-13-font-weight)' as CSSProperties['fontWeight'],
};

/** Secondary action: the ghost/bordered chip the shipped surfaces use. */
const terseButton: CSSProperties = {
  ...buttonBase,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  border: '.5px solid var(--dsw-alias-border-l4)',
};

/** Primary action: the filled brand button (`button-primary-fill` + inverted label). */
const primaryButton: CSSProperties = {
  ...buttonBase,
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
  border: '.5px solid transparent',
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  borderRadius: 'var(--dsw-radius-lg)',
  resize: 'vertical',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  border: '.5px solid var(--dsw-alias-border-l4)',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsw-font-xs-13-font-size)',
  lineHeight: 'var(--dsw-font-xs-13-line-height)',
};

const fileRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 0',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

/** Secondary copy: the 12px caption tone the frame uses for metadata. */
const mutedStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 'var(--dsw-font-xxs-12-font-size)',
  lineHeight: 'var(--dsw-font-xxs-12-line-height)',
};

/** The `+n -m` stat: tabular figures so the pill does not jitter as it counts. */
const statStyle: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  fontVariantNumeric: 'tabular-nums',
};

/** Added lines, in the theme's own success tone. */
const additionStyle: CSSProperties = { color: 'var(--dsw-alias-state-success-primary)' };

/** Removed lines, in the theme's own error tone. */
const deletionStyle: CSSProperties = { color: 'var(--dsw-alias-state-error-primary)' };

/**
 * A themed button. Hover is the one affordance inline styles cannot express
 * through a token, so it swaps between the two interactive fills the shipped
 * surfaces use instead of writing a literal colour.
 */
function HoverButton({
  style,
  hoverStyle,
  ...rest
}: {
  style: CSSProperties;
  hoverStyle: CSSProperties;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      {...rest}
      style={hover && !rest.disabled ? { ...style, ...hoverStyle } : style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  );
}

/** Fill swap for a secondary action on hover. */
const ghostHover: CSSProperties = { background: 'var(--dsw-alias-interactive-bg-hover)' };

/** Fill swap for the primary action on hover. */
const primaryHover: CSSProperties = { background: 'var(--dsw-alias-button-primary-hover)' };

/**
 * The workspace of the conversation the main view is showing.
 *
 * DSH's own client surfaces identify the open conversation by its `mainView`
 * retention — the shell retains exactly the Session it renders, blank ones
 * included — so the panel reads that same fact instead of guessing from list
 * order. A conversation switch therefore moves the pill with it, and no other
 * workspace can ever take its place.
 * @param state - current session list snapshot.
 * @returns the conversation's directory, or null while no Session is retained.
 */
function conversationWorkspace(state: SessionListState): string | null {
  for (const row of Object.values(state.byId)) {
    if ((row.retainedBy.mainView ?? 0) > 0) return row.cwd ?? null;
  }
  return null;
}

/**
 * One occurrence of the floating commit panel.
 * @param props - composed slot props (locale seat + injected business face).
 * @returns the pill while the conversation's workspace has changes, otherwise nothing.
 */
export function Panel(props: PanelProps): ReactElement | null {
  const { t, git, useGitCommitStatus, setStatus, useSessions } = props;

  const status = useGitCommitStatus((current) => current ?? null);
  // The one workspace this panel is ever about: the directory the conversation
  // in the main view sits in. Nothing else is a candidate.
  const workspace = useSessions(conversationWorkspace);

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState('');
  /** Model that drafted the current message, empty when the user wrote it. */
  const [draftedBy, setDraftedBy] = useState('');
  const [stageAll, setStageAll] = useState(true);
  const [showFiles, setShowFiles] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'loading' | 'generating' | 'committing'>('idle');
  const [error, setError] = useState<GitCommitError | null>(null);
  const [notice, setNotice] = useState('');

  // A handled failure is written to the panel; mirror it to the console so a
  // diagnosis does not have to reproduce the click that produced it. Provider
  // failures carry their own request id there.
  useEffect(() => {
    if (error === null) return;
    console.warn(
      `[dsh-git-commit-panel] ${error.code}: ${error.message}${error.detail === undefined ? '' : ` — ${error.detail}`}`,
    );
  }, [error]);

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const inFlightRef = useRef(false);
  /** A scan request that arrived while one was running, so a switch is never dropped. */
  const queuedRef = useRef(false);
  const lastScanRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  /** Probe one workspace; resolves to its status when it has work-tree changes. */
  const probe = useCallback(async (path: string): Promise<RepoStatus | null> => {
    const result = await git.status(path);
    if (!result.ok) return null;
    const value = result.value;
    if (value === null || !value.hasUnstagedChanges) return null;
    return value;
  }, [git]);

  /**
   * Probe the current conversation's workspace and publish what the pill should
   * show. The status is re-read rather than reused: a clean tree (a commit made
   * in a terminal, or a switched conversation) has to retire the pill.
   *
   * A request that arrives while a probe runs is remembered and served by that
   * same call, so switching conversations never waits out the poll interval.
   */
  const refresh = useCallback(async (force: boolean): Promise<void> => {
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }
    const now = Date.now();
    if (!force && now - lastScanRef.current < SCAN_MIN_INTERVAL_MS) return;
    inFlightRef.current = true;
    try {
      const target = workspaceRef.current;
      const found = target === null ? null : await probe(target);
      if (!mountedRef.current) return;
      setStatus(found);
    } finally {
      inFlightRef.current = false;
      lastScanRef.current = Date.now();
      if (queuedRef.current) {
        queuedRef.current = false;
        void refresh(true);
      }
    }
  }, [probe, setStatus]);

  // Discovery: on mount, whenever the conversation's workspace changes, and on
  // tab focus.
  useEffect(() => {
    void refresh(true);
  }, [workspace, refresh]);

  useEffect(() => {
    const onFocus = (): void => { void refresh(false); };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(false);
    }, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const unstagedFiles = useMemo(
    () => (status?.files ?? []).filter((file) => file.unstaged),
    [status],
  );
  const stagedCount = status?.summary.staged ?? 0;
  // A host half that predates the line totals simply renders none of them.
  const additions = status?.lines?.additions ?? 0;
  const deletions = status?.lines?.deletions ?? 0;

  /** Refresh from the panel's own button. */
  const onRefresh = useCallback((): void => {
    setError(null);
    void refresh(true);
  }, [refresh]);

  /**
   * Ask the host for a Conventional Commit message, preferring the selected
   * model. Returns the message and the model that drafted it, or null after
   * surfacing the failure.
   */
  const generateMessage = useCallback(async (): Promise<{ message: string; model: string } | null> => {
    if (status === null) return null;
    setError(null);
    setNotice('');
    const result = await git.generate(status.workspace, {
      staged: !stageAll && stagedCount > 0,
      locale: typeof navigator === 'undefined' ? 'en' : navigator.language,
      ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
    });
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setMessage(result.value.message);
    setDraftedBy(result.value.model);
    return { message: result.value.message, model: result.value.model };
  }, [git, hint, stageAll, stagedCount, status]);

  /** The Generate with AI button. */
  const onGenerate = useCallback(async (): Promise<void> => {
    setBusy('generating');
    try {
      await generateMessage();
    } finally {
      setBusy('idle');
    }
  }, [generateMessage]);

  /**
   * Commit (and optionally push) through the host. An empty message box is not
   * an error: the AI drafts the message first, the draft lands in the box, and
   * that text is what gets committed — the same sequence ZCode's commit dialog
   * uses.
   */
  const onCommit = useCallback(async (push: boolean): Promise<void> => {
    if (status === null) return;
    setError(null);
    setNotice('');

    let outgoing = message;
    if (message.trim() === '') {
      setBusy('generating');
      const drafted = await generateMessage();
      if (drafted === null) {
        setBusy('idle');
        return;
      }
      outgoing = drafted.message;
    }

    setBusy('committing');
    try {
      const result = await git.commit({
        path: status.workspace,
        message: outgoing,
        stageAll,
        push,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage('');
      setDraftedBy('');
      setNotice(describeCommit(result.value, t));
      setStatus(null);
      await refresh(true);
    } finally {
      setBusy('idle');
    }
  }, [generateMessage, git, message, refresh, setStatus, stageAll, status, t]);

  if (status === null) return null;

  const branchLabel = status.detached || status.branch === null ? t('detached') : status.branch;

  if (!open) {
    return (
      <div style={panelRootBase} data-dsh-git-commit-panel-root="pill">
        <HoverButton
          style={badgeStyle}
          hoverStyle={ghostHover}
          title={t('badgeTitle')}
          data-dsh-git-commit-panel="pill"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">⑂</span>
          <span>{branchLabel}</span>
          <span style={mutedStyle}>{t('badgeFiles', { count: status.summary.unstaged })}</span>
          {additions > 0 || deletions > 0 ? (
            <span style={statStyle} data-dsh-git-commit-panel="stat">
              {/* A side with nothing to report is left out rather than shown as 0. */}
              {additions > 0 ? <span style={additionStyle}>{`+${additions}`}</span> : null}
              {deletions > 0 ? <span style={deletionStyle}>{`-${deletions}`}</span> : null}
            </span>
          ) : null}
        </HoverButton>
      </div>
    );
  }

  const committing = busy === 'committing';
  const generating = busy === 'generating';
  // An empty message is a valid commit: the AI drafts the text first, so the
  // only real precondition is having something to commit.
  const hasSomethingToCommit = stageAll ? status.files.length > 0 : stagedCount > 0;
  const canCommit = !busy.startsWith('gen') && !committing && hasSomethingToCommit;

  return (
    <div style={panelRootBase} data-dsh-git-commit-panel-root="card">
      <section
        style={panelStyle}
        role="dialog"
        aria-label={t('title')}
        data-dsh-git-commit-panel="card"
      >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ flex: 1 }}>{t('title')}</strong>
        <span style={mutedStyle}>{branchLabel}</span>
        {status.upstream !== null && (status.ahead > 0 || status.behind > 0) ? (
          <span style={mutedStyle}>{t('upstreamAheadBehind', { ahead: status.ahead, behind: status.behind })}</span>
        ) : null}
        <HoverButton
          style={terseButton}
          hoverStyle={ghostHover}
          data-dsh-git-commit-panel="refresh"
          onClick={onRefresh}
          title={t('refresh')}
        >
          ↻
        </HoverButton>
        <HoverButton
          style={terseButton}
          hoverStyle={ghostHover}
          data-dsh-git-commit-panel="close"
          onClick={() => {
            setOpen(false);
            setError(null);
            setNotice('');
          }}
          title={t('close')}
        >
          ✕
        </HoverButton>
      </header>

      <div style={mutedStyle}>{t('fileCount', {
        total: status.summary.total,
        staged: status.summary.staged,
        unstaged: status.summary.unstaged,
      })}</div>

      <HoverButton
        style={{ ...terseButton, textAlign: 'left' }}
        hoverStyle={ghostHover}
        onClick={() => setShowFiles((value) => !value)}
      >
        {showFiles ? t('hideFiles') : t('showFiles')}
      </HoverButton>

      {showFiles ? (
        <div style={{ maxHeight: 160, overflow: 'auto', fontFamily: 'var(--dsw-font-markdown-code-font-family)', fontSize: 'var(--dsw-font-markdown-code-font-size)' }}>
          {unstagedFiles.length === 0 ? <div style={mutedStyle}>{t('noUnstaged')}</div> : null}
          {unstagedFiles.map((file) => (
            <div key={`${file.path}:${file.from ?? ''}`} style={fileRowStyle} title={file.path}>
              <span style={{ width: 12, flex: 'none', opacity: 0.8 }}>{KIND_MARK[file.kind]}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {file.from === undefined ? file.path : `${file.from} → ${file.path}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={mutedStyle}>{t('messageLabel')}</span>
        <textarea
          rows={3}
          style={inputStyle}
          value={message}
          placeholder={t('messagePlaceholder')}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
              event.preventDefault();
              void onCommit(false);
            }
          }}
        />
        <span style={mutedStyle}>
          {message.trim() === ''
            ? t('emptyGenerates')
            : draftedBy === ''
              ? ''
              : t('generatedBy', { model: draftedBy })}
        </span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={mutedStyle}>{t('hintLabel')}</span>
        <input
          style={inputStyle}
          value={hint}
          placeholder={t('hintPlaceholder')}
          onChange={(event) => setHint(event.target.value)}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={stageAll}
          onChange={(event) => setStageAll(event.target.checked)}
        />
        <span>{t('stageAll')}</span>
        <span style={mutedStyle}>{t('stageAllHint')}</span>
      </label>
      {!stageAll && stagedCount === 0 ? <div style={mutedStyle}>{t('noStaged')}</div> : null}

      {/* `state-error-primary` is the token every shipped error message uses. */}
      {error !== null ? (
        <div
          style={{ color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' }}
          data-dsh-git-commit-panel="error"
        >
          {/* The verb in the failure belongs to the code, not to the button
              that happened to be pressed: an empty box that fails to draft is a
              generation failure, not a commit failure. */}
          <div>{`${t(errorHeading(error.code))} [${error.code}] ${error.message}`}</div>
          {error.detail !== undefined && error.detail !== '' ? (
            <div style={{ ...mutedStyle, maxHeight: 80, overflow: 'auto' }}>{error.detail}</div>
          ) : null}
        </div>
      ) : null}
      {notice !== '' ? <div style={mutedStyle}>{notice}</div> : null}

      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <HoverButton
          style={terseButton}
          hoverStyle={ghostHover}
          disabled={generating || committing}
          onClick={() => { void onGenerate(); }}
        >
          {generating ? t('generating') : t('generate')}
        </HoverButton>
        <HoverButton
          style={terseButton}
          hoverStyle={ghostHover}
          data-dsh-git-commit-panel="commit"
          disabled={!canCommit || committing}
          onClick={() => { void onCommit(false); }}
        >
          {committing ? t('committing') : t('commit')}
        </HoverButton>
        <HoverButton
          style={primaryButton}
          hoverStyle={primaryHover}
          data-dsh-git-commit-panel="commit-push"
          disabled={!canCommit || committing}
          onClick={() => { void onCommit(true); }}
        >
          {t('commitAndPush')}
        </HoverButton>
      </footer>
      </section>
    </div>
  );
}

/** Dictionary key of the failure heading that belongs to one error code. */
function errorHeading(code: GitCommitError['code']): 'generateFailed' | 'commitFailed' {
  switch (code) {
    case 'model-failed':
    case 'model-unavailable':
      return 'generateFailed';
    default:
      return 'commitFailed';
  }
}

/** One-line summary of a settled commit. */
function describeCommit(result: CommitResult, t: PanelProps['t']): string {
  const head = `${result.commit.slice(0, 8)} ${result.subject}`;
  if (!result.pushed) return head;
  return `${head} · ${t('commits')} ${t('andPush')}`;
}
