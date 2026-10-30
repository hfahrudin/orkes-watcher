// The repo's docs/ markdown (trace contracts and release changelogs), bundled at build time
// and rendered in the app. Files are named by version:
//   docs/contracts/contract-<MAJOR.MINOR>.md   docs/changelogs/<X.Y.Z>.md
// The Docker build gets docs/ as an extra build context (see docker-compose.yml).
import { Marked } from 'marked'

export type DocKind = 'contract' | 'changelog'

const REPO = 'https://github.com/hfahrudin/orkes-watcher/blob/main'
const FOLDER: Record<DocKind, string> = { contract: 'contracts', changelog: 'changelogs' }

const raw = (files: Record<string, string>, pattern: RegExp) =>
  new Map(Object.entries(files).flatMap(([path, text]) => {
    const version = pattern.exec(path)?.[1]
    return version ? [[version, text] as const] : []
  }))

const FILES: Record<DocKind, Map<string, string>> = {
  contract: raw(
    import.meta.glob<string>('../../../docs/contracts/contract-*.md', { query: '?raw', import: 'default', eager: true }),
    /contract-(\d+\.\d+)\.md$/,
  ),
  changelog: raw(
    import.meta.glob<string>('../../../docs/changelogs/*.md', { query: '?raw', import: 'default', eager: true }),
    /\/(\d+\.\d+\.\d+)\.md$/,
  ),
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Versions this build has a doc for, newest first. */
export function docVersions(kind: DocKind): string[] {
  return [...FILES[kind].keys()].sort((a, b) => compareVersions(b, a))
}

export function docMarkdown(kind: DocKind, version: string): string | undefined {
  return FILES[kind].get(version)
}

export const docRoute = (kind: DocKind, version: string) => `/${kind}/${version}`
export const docSourceUrl = (kind: DocKind, version: string) =>
  `${REPO}/docs/${FOLDER[kind]}/${kind === 'contract' ? `contract-${version}` : version}.md`

/** GitHub's heading anchors: "2.6 `RunEndEvent`" -> "26-runendevent". */
function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Where a link in a doc should go: anchors stay, links to other contract/changelog files
 * open in the app, other repo files open on GitHub. */
function resolveLink(kind: DocKind, href: string): { href: string; internal: boolean; external: boolean } {
  if (href.startsWith('#')) return { href, internal: false, external: false }
  if (/^[a-z]+:/i.test(href)) return { href, internal: false, external: true }
  const url = new URL(href, `${REPO}/docs/${FOLDER[kind]}/`)
  const contract = /\/docs\/contracts\/contract-(\d+\.\d+)\.md$/.exec(url.pathname)
  if (contract) return { href: docRoute('contract', contract[1]) + url.hash, internal: true, external: false }
  const changelog = /\/docs\/changelogs\/(\d+\.\d+\.\d+)\.md$/.exec(url.pathname)
  if (changelog) return { href: docRoute('changelog', changelog[1]) + url.hash, internal: true, external: false }
  return { href: url.toString(), internal: false, external: true }
}

/** The doc as HTML. Only the repo's own docs are rendered, never user content. */
export function renderDoc(kind: DocKind, markdown: string): string {
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        return `<h${depth} id="${escapeAttr(slug(text))}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const target = resolveLink(kind, href)
        const attrs = [
          `href="${escapeAttr(target.href)}"`,
          title ? `title="${escapeAttr(title)}"` : '',
          target.internal ? 'data-internal' : '',
          target.external ? 'target="_blank" rel="noreferrer"' : '',
        ].filter(Boolean)
        return `<a ${attrs.join(' ')}>${this.parser.parseInline(tokens)}</a>`
      },
    },
  })
  return md.parse(markdown, { async: false })
}
