// Release notes of a version for the modal after an update (app/components/ReleaseNotesModal.vue). The server
// fetches them, since the page's CSP allows no foreign hosts: one request to GitHub, like the update check, that
// sends nothing but the version (User-Agent).

/** Elements kept (without attributes, except `href` of links); others are replaced by their content. */
const KEPT = new Set(
  (
    'a b blockquote br code del details em h1 h2 h3 h4 h5 h6 hr i kbd li ol p pre s strong sub summary sup ' +
    'table tbody td th thead tr ul'
  ).split(' '),
)
/** Elements removed with their content; images too, which would load from foreign hosts. */
const REMOVED = new Set(
  (
    'script style iframe object embed template form input button select textarea svg math ' +
    'img video audio picture source'
  ).split(' '),
)

/**
 * The release notes of `v<version>` as HTML (`body_html`, rendered and sanitized by GitHub), reduced to plain
 * formatting and https links. Rejects if GitHub cannot be reached or has no such release.
 */
export async function releaseNotes(repository: string, version: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, {
    headers: { accept: 'application/vnd.github.html+json', 'user-agent': `Colwerk/${version}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`)
  const { body_html } = (await res.json()) as { body_html?: string }
  return sanitize(body_html ?? '')
}

/** Allowlist of elements and attributes: the HTML is shown in the page (v-html), so nothing in it may run. */
export function sanitize(html: string): string {
  return new HTMLRewriter()
    .on('*', {
      element(el) {
        if (REMOVED.has(el.tagName)) el.remove()
        else if (!KEPT.has(el.tagName)) el.removeAndKeepContent()
        else {
          for (const [name, value] of [...el.attributes]) {
            if (!(el.tagName === 'a' && name === 'href' && value.startsWith('https://'))) el.removeAttribute(name)
          }
        }
      },
    })
    .onDocument({
      comments(c) {
        c.remove()
      },
    })
    .transform(html)
}
