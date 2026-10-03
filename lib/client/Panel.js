import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The floating commit panel. Rendered into the frame-wide `shell.overlay`
 * seat, it shows a small pill while the picked workspace has work-tree
 * changes and expands into a commit card: changed-file list, a message box
 * that the user can write or have the host's model draft, and the two commit
 * actions.
 *
 * The component is deliberately data-poor: it receives the standard
 * `useSessions` / `useWorkspaces` seats and one injected status hook, and every
 * git or model decision happens in the host half through {@link GitCommitApi}.
 *
 * @module dsh-git-commit-panel/client/Panel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
const POLL_INTERVAL_MS = 20_000;
const SCAN_MIN_INTERVAL_MS = 3_000;
/** Colour-carrying change-kind glyph. */
const KIND_MARK = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    typechange: 'T',
    unmerged: 'U',
    untracked: '?',
};
/** Theme-native surface styles; every colour is a semantic DSH token. */
const panelStyle = {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 'min(420px, calc(100vw - 40px))',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    pointerEvents: 'auto',
    background: 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, Canvas))',
    color: 'var(--dsw-alias-label-primary, CanvasText)',
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
    boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
    font: '13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
};
const badgeStyle = {
    position: 'absolute',
    right: 20,
    bottom: 20,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 999,
    pointerEvents: 'auto',
    cursor: 'pointer',
    background: 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, Canvas))',
    color: 'var(--dsw-alias-label-primary, CanvasText)',
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
    boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
    font: '13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
};
const terseButton = {
    padding: '5px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary, CanvasText)',
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
    font: 'inherit',
};
const primaryButton = {
    ...terseButton,
    background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
    color: '#fff',
    border: '1px solid transparent',
    fontWeight: 600,
};
const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 10,
    resize: 'vertical',
    background: 'var(--dsw-alias-bg-base, Canvas)',
    color: 'var(--dsw-alias-label-primary, CanvasText)',
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
    font: 'inherit',
};
const fileRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '2px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
};
const mutedStyle = {
    color: 'var(--dsw-alias-label-secondary, GrayText)',
    fontSize: 12,
};
/** Deduplicate and order the candidate workspaces the panel may inspect. */
function candidatesOf(sessionCwds, workspacePaths) {
    const seen = new Set();
    const out = [];
    for (const path of [...sessionCwds, ...workspacePaths]) {
        if (path === undefined || path === '')
            continue;
        const key = path.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(path);
    }
    return out;
}
/**
 * Stable identity of the candidate set: the workspace scan only restarts when
 * this changes, not on every unrelated session or workspace list mutation.
 */
function candidatesKey(candidates) {
    return candidates.map((path) => path.toLowerCase()).join('\u0000');
}
/** Wait for a macrotask so each git probe yields to rendering. */
function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
/**
 * One occurrence of the floating commit panel.
 * @param props - composed slot props (locale seat + injected business face).
 * @returns the pill, the expanded card, or nothing while no workspace has changes.
 */
export function Panel(props) {
    const { t, git, useGitCommitStatus, setStatus, useSessions, useWorkspaces } = props;
    const status = useGitCommitStatus((current) => current ?? null);
    const sessionCwds = useSessions((state) => state.ids.map((id) => state.byId[id]?.cwd), sameArray);
    const workspacePaths = useWorkspaces((snapshot) => snapshot.items.map((item) => item.path), sameArray);
    const candidates = useMemo(() => candidatesOf(sessionCwds, workspacePaths), [sessionCwds, workspacePaths]);
    const candidateKey = candidatesKey(candidates);
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [hint, setHint] = useState('');
    const [stageAll, setStageAll] = useState(true);
    const [showFiles, setShowFiles] = useState(false);
    const [busy, setBusy] = useState('idle');
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState('');
    const candidatesRef = useRef(candidates);
    candidatesRef.current = candidates;
    const statusRef = useRef(status);
    statusRef.current = status;
    const inFlightRef = useRef(false);
    const lastScanRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => () => {
        mountedRef.current = false;
    }, []);
    /** Probe one workspace; resolves to its status when it has work-tree changes. */
    const probe = useCallback(async (path) => {
        const result = await git.status(path);
        if (!result.ok)
            return null;
        const value = result.value;
        if (value === null || !value.hasUnstagedChanges)
            return null;
        return value;
    }, [git]);
    /**
     * Pick the workspace to show: the first candidate with work-tree changes,
     * preferring the ones an active session currently sits in.
     */
    const refresh = useCallback(async (force) => {
        if (inFlightRef.current)
            return;
        const now = Date.now();
        if (!force && now - lastScanRef.current < SCAN_MIN_INTERVAL_MS)
            return;
        inFlightRef.current = true;
        try {
            const current = statusRef.current;
            if (current !== null) {
                const stillChanged = await probe(current.workspace);
                if (stillChanged !== null) {
                    setStatus(stillChanged);
                    return;
                }
            }
            for (const candidate of candidatesRef.current) {
                const found = await probe(candidate);
                if (!mountedRef.current)
                    return;
                if (found !== null) {
                    setStatus(found);
                    return;
                }
                await nextTick();
            }
            setStatus(null);
        }
        finally {
            inFlightRef.current = false;
            lastScanRef.current = Date.now();
        }
    }, [probe, setStatus]);
    // Discovery: on mount, whenever the candidate set changes, and on tab focus.
    useEffect(() => {
        void refresh(true);
    }, [candidateKey, refresh]);
    useEffect(() => {
        const onFocus = () => { void refresh(false); };
        const onVisible = () => {
            if (document.visibilityState === 'visible')
                void refresh(false);
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible')
                void refresh(false);
        }, POLL_INTERVAL_MS);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
            window.clearInterval(timer);
        };
    }, [refresh]);
    const unstagedFiles = useMemo(() => (status?.files ?? []).filter((file) => file.unstaged), [status]);
    const stagedCount = status?.summary.staged ?? 0;
    /** Refresh from the panel's own button. */
    const onRefresh = useCallback(() => {
        setError(null);
        void refresh(true);
    }, [refresh]);
    /** Ask the host's default model to draft the message. */
    const onGenerate = useCallback(async () => {
        if (status === null)
            return;
        setBusy('generating');
        setError(null);
        setNotice('');
        try {
            const result = await git.generate(status.workspace, {
                staged: !stageAll && stagedCount > 0,
                locale: typeof navigator === 'undefined' ? 'en' : navigator.language,
                ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
            });
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage(result.value.message);
        }
        finally {
            setBusy('idle');
        }
    }, [git, hint, stageAll, stagedCount, status]);
    /** Commit (and optionally push) through the host. */
    const onCommit = useCallback(async (push) => {
        if (status === null)
            return;
        if (message.trim() === '') {
            setError({ code: 'bad-request', message: t('emptyMessage') });
            return;
        }
        setBusy('committing');
        setError(null);
        setNotice('');
        try {
            const result = await git.commit({
                path: status.workspace,
                message,
                stageAll,
                push,
            });
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage('');
            setNotice(describeCommit(result.value, t));
            setStatus(null);
            await refresh(true);
        }
        finally {
            setBusy('idle');
        }
    }, [git, message, refresh, setStatus, stageAll, status, t]);
    if (status === null)
        return null;
    const branchLabel = status.detached || status.branch === null ? t('detached') : status.branch;
    if (!open) {
        return (_jsxs("button", { type: "button", style: badgeStyle, title: t('badgeTitle'), onClick: () => setOpen(true), children: [_jsx("span", { "aria-hidden": "true", children: "\u2442" }), _jsx("span", { children: branchLabel }), _jsx("span", { style: mutedStyle, children: t('badgeFiles', { count: status.summary.unstaged }) })] }));
    }
    const committing = busy === 'committing';
    const generating = busy === 'generating';
    const canCommit = message.trim() !== '' && !committing
        && (stageAll ? status.files.length > 0 : stagedCount > 0);
    return (_jsxs("section", { style: panelStyle, role: "dialog", "aria-label": t('title'), children: [_jsxs("header", { style: { display: 'flex', alignItems: 'baseline', gap: 8 }, children: [_jsx("strong", { style: { flex: 1 }, children: t('title') }), _jsx("span", { style: mutedStyle, children: branchLabel }), status.upstream !== null && (status.ahead > 0 || status.behind > 0) ? (_jsx("span", { style: mutedStyle, children: t('upstreamAheadBehind', { ahead: status.ahead, behind: status.behind }) })) : null, _jsx("button", { type: "button", style: terseButton, onClick: onRefresh, title: t('refresh'), children: "\u21BB" }), _jsx("button", { type: "button", style: terseButton, onClick: () => {
                            setOpen(false);
                            setError(null);
                            setNotice('');
                        }, title: t('close'), children: "\u2715" })] }), _jsx("div", { style: mutedStyle, children: t('fileCount', {
                    total: status.summary.total,
                    staged: status.summary.staged,
                    unstaged: status.summary.unstaged,
                }) }), _jsx("button", { type: "button", style: { ...terseButton, textAlign: 'left' }, onClick: () => setShowFiles((value) => !value), children: showFiles ? t('hideFiles') : t('showFiles') }), showFiles ? (_jsxs("div", { style: { maxHeight: 160, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 12 }, children: [unstagedFiles.length === 0 ? _jsx("div", { style: mutedStyle, children: t('noUnstaged') }) : null, unstagedFiles.map((file) => (_jsxs("div", { style: fileRowStyle, title: file.path, children: [_jsx("span", { style: { width: 12, flex: 'none', opacity: 0.8 }, children: KIND_MARK[file.kind] }), _jsx("span", { style: { overflow: 'hidden', textOverflow: 'ellipsis' }, children: file.from === undefined ? file.path : `${file.from} → ${file.path}` })] }, `${file.path}:${file.from ?? ''}`)))] })) : null, _jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("span", { style: mutedStyle, children: t('messageLabel') }), _jsx("textarea", { rows: 3, style: inputStyle, value: message, placeholder: t('messagePlaceholder'), onChange: (event) => setMessage(event.target.value), onKeyDown: (event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
                                event.preventDefault();
                                void onCommit(false);
                            }
                        } })] }), _jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("span", { style: mutedStyle, children: t('hintLabel') }), _jsx("input", { style: inputStyle, value: hint, placeholder: t('hintPlaceholder'), onChange: (event) => setHint(event.target.value) })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("input", { type: "checkbox", checked: stageAll, onChange: (event) => setStageAll(event.target.checked) }), _jsx("span", { children: t('stageAll') }), _jsx("span", { style: mutedStyle, children: t('stageAllHint') })] }), !stageAll && stagedCount === 0 ? _jsx("div", { style: mutedStyle, children: t('noStaged') }) : null, error !== null ? (_jsxs("div", { style: { color: 'var(--dsw-alias-label-error, #d9534f)', whiteSpace: 'pre-wrap' }, children: [_jsx("div", { children: `${t('commitFailed')} [${error.code}] ${error.message}` }), error.detail !== undefined && error.detail !== '' ? (_jsx("div", { style: { ...mutedStyle, maxHeight: 80, overflow: 'auto' }, children: error.detail })) : null] })) : null, notice !== '' ? _jsx("div", { style: mutedStyle, children: notice }) : null, _jsxs("footer", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }, children: [_jsx("button", { type: "button", style: terseButton, disabled: generating || committing, onClick: () => { void onGenerate(); }, children: generating ? t('generating') : t('generate') }), _jsx("button", { type: "button", style: terseButton, disabled: !canCommit || committing, onClick: () => { void onCommit(false); }, children: committing ? t('committing') : t('commit') }), _jsx("button", { type: "button", style: primaryButton, disabled: !canCommit || committing, onClick: () => { void onCommit(true); }, children: t('commitAndPush') })] })] }));
}
/** Reference equality for the two projected string arrays. */
function sameArray(left, right) {
    if (left === right)
        return true;
    if (left.length !== right.length)
        return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index])
            return false;
    }
    return true;
}
/** One-line summary of a settled commit. */
function describeCommit(result, t) {
    const head = `${result.commit.slice(0, 8)} ${result.subject}`;
    if (!result.pushed)
        return head;
    return `${head} · ${t('commits')} ${t('andPush')}`;
}
