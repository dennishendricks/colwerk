import { afterEach, test } from 'bun:test'
import { assertEquals, assertRejects } from './assert.ts'
import { releaseNotes, sanitize } from '../server/utils/release-notes.ts'

const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))

function mockFetch(status: number, body: unknown): Request[] {
  const requests: Request[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Response.json(body, { status })
  }) as typeof fetch
  return requests
}

test('release notes: one request for the tag, generic User-Agent, sanitized HTML', async () => {
  const requests = mockFetch(200, { body_html: '<h2>Fixes</h2><script>alert(1)</script>' })
  assertEquals(await releaseNotes('owner/repo', '1.2.3'), '<h2>Fixes</h2>')
  assertEquals(requests.length, 1)
  assertEquals(requests[0]!.url, 'https://api.github.com/repos/owner/repo/releases/tags/v1.2.3')
  assertEquals(requests[0]!.headers.get('accept'), 'application/vnd.github.html+json')
  assertEquals(requests[0]!.headers.get('user-agent'), 'Colwerk/1.2.3')
})

test('release notes: rejects without such release', async () => {
  mockFetch(404, { message: 'Not Found' })
  await assertRejects(() => releaseNotes('owner/repo', '1.2.3'), Error, '404')
})

test('sanitize: keeps formatting and https links, drops scripts, handlers and foreign elements', () => {
  assertEquals(
    sanitize(
      '<div class="x"><p onclick="x()">Fix <a href="https://github.com/a/b/pull/1" class="issue-link">#1</a>' +
        ' <a href="javascript:alert(1)">js</a><!-- note --></p>' +
        '<img src="https://example.com/t.png" onerror="x()"><style>p{}</style><iframe src="https://example.com"></iframe>' +
        '<ul><li><code>a</code> <span style="color:red">b</span></li></ul></div>',
    ),
    '<p>Fix <a href="https://github.com/a/b/pull/1">#1</a> <a>js</a></p><ul><li><code>a</code> b</li></ul>',
  )
})
