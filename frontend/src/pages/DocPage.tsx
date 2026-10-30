import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import { type DocKind, docMarkdown, docRoute, docSourceUrl, docVersions, renderDoc } from '../lib/docs'

const TITLE: Record<DocKind, string> = { contract: 'Trace contract', changelog: 'Changelog' }
const BLURB: Record<DocKind, string> = {
  contract: 'The format orkes uses to send runs to this watcher.',
  changelog: 'What changed in each watcher release.',
}

/** A contract or changelog version from the repo's docs/, rendered as a page. */
export function DocPage({ kind }: { kind: DocKind }) {
  const { version } = useParams<{ version?: string }>()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const versions = docVersions(kind)
  const markdown = version ? docMarkdown(kind, version) : undefined
  const html = useMemo(() => (markdown ? renderDoc(kind, markdown) : ''), [kind, markdown])

  // The version this watcher is running (or the contract it speaks), marked in the version list.
  const [running, setRunning] = useState<string | null>(null)
  useEffect(() => {
    api.getVersion().then((v) => setRunning(kind === 'contract' ? v.contract.latest : v.watcher_version)).catch(() => setRunning(null))
  }, [kind])

  // Jump to #section on load, and back to the top when switching versions.
  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (target) target.scrollIntoView()
    else document.querySelector('.main')?.scrollTo({ top: 0 })
  }, [html, hash])

  if (!version) return versions.length ? <Navigate to={docRoute(kind, versions[0])} replace /> : <Missing kind={kind} />

  // Links between docs open in the app; #anchors scroll within the page.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    const href = a.getAttribute('href') ?? ''
    if (a.hasAttribute('data-internal')) {
      e.preventDefault()
      navigate(href)
    } else if (href.startsWith('#')) {
      e.preventDefault()
      navigate({ hash: href }, { replace: true })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h4 style={{ margin: 0 }}>{TITLE[kind]}</h4>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-dim)' }}>{BLURB[kind]}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {versions.length > 0 && (
            <div className="seg" role="tablist" aria-label="Versions">
              {versions.map((v) => (
                <Link key={v} to={docRoute(kind, v)} className="seg-opt mono doc-version" aria-current={v === version ? 'page' : undefined} title={v === running ? 'This watcher' : undefined}>
                  {v}
                  {v === running && <span className="status-dot finished" style={{ margin: 0, width: 6, height: 6 }} />}
                </Link>
              ))}
            </div>
          )}
          <Link to={docRoute(kind === 'contract' ? 'changelog' : 'contract', kind === 'contract' ? (docVersions('changelog')[0] ?? '') : (docVersions('contract')[0] ?? ''))} className="btn btn-ghost btn-sm">
            {kind === 'contract' ? 'Changelog' : 'Trace contract'}
          </Link>
          <a className="btn btn-secondary btn-sm" href={docSourceUrl(kind, version)} target="_blank" rel="noreferrer">
            <i className="ph ph-github-logo" />
            View on GitHub
          </a>
        </div>
      </div>

      {markdown ? (
        // Rendered from the repo's own markdown files at build time, never from user input.
        <article className="doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <Missing kind={kind} version={version} />
      )}
    </div>
  )
}

function Missing({ kind, version }: { kind: DocKind; version?: string }) {
  return (
    <div className="empty-state">
      <span>{version ? `No ${kind} for version ${version} in this build.` : `No ${kind} files in this build.`}</span>
      <span className="text-muted" style={{ fontSize: 12.5 }}>
        They come from <span className="mono">docs/{kind === 'contract' ? 'contracts' : 'changelogs'}/</span> in the repo.
      </span>
    </div>
  )
}
