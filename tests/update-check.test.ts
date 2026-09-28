import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHECK_INTERVAL_MS,
  DUE_CHECK_TICK_MS,
  FIRST_CHECK_DELAY_MS,
  UpdateChecker,
  fetchLatestRelease,
  releasePage,
  type UpdateFetch
} from '../src/main/update-check'
import { compareVersions, isVersion, updateResultText } from '../src/shared/update'

const REPO = 'banuca/murmur'

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function release(tag: string, url = `https://github.com/${REPO}/releases/tag/${tag}`) {
  return reply(200, { tag_name: tag, html_url: url, name: 'ignored', assets: [{ id: 1 }] })
}

describe('compareVersions', () => {
  it('orders releases, with or without a leading v', () => {
    expect(compareVersions('0.6.0', '0.5.0')).toBe(1)
    expect(compareVersions('v0.6.0', '0.6.0')).toBe(0)
    expect(compareVersions('0.5.9', 'v0.6.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
  })

  it('puts a pre-release before its release', () => {
    expect(compareVersions('0.6.0-beta.1', '0.6.0')).toBe(-1)
    expect(compareVersions('0.6.0', '0.6.0-rc.1')).toBe(1)
    expect(compareVersions('0.6.0-beta.2', '0.6.0-beta.10')).toBe(-1)
    expect(compareVersions('0.6.0-alpha', '0.6.0-beta')).toBe(-1)
    expect(compareVersions('0.6.0-1', '0.6.0-alpha')).toBe(-1)
    expect(compareVersions('0.6.0-beta', '0.6.0-beta.1')).toBe(-1)
    // Newer still wins over a pre-release of an older line.
    expect(compareVersions('0.7.0-beta.1', '0.6.0')).toBe(1)
  })

  it('never ranks something that is not a version above one', () => {
    expect(isVersion('latest')).toBe(false)
    expect(compareVersions('latest', '0.4.0')).toBe(-1)
    expect(compareVersions('0.4.0', 'nightly')).toBe(1)
  })
})

describe('releasePage', () => {
  it("uses GitHub's link only when it is this repository's release page", () => {
    expect(releasePage(REPO, `https://github.com/${REPO}/releases/tag/v0.6.0`)).toBe(
      `https://github.com/${REPO}/releases/tag/v0.6.0`
    )
    for (const url of [
      'https://evil.example/releases/tag/v0.6.0',
      `https://github.com/someone-else/murmur/releases/tag/v0.6.0`,
      `http://github.com/${REPO}/releases/tag/v0.6.0`,
      `https://github.com/${REPO}/archive/main.zip`,
      42,
      undefined
    ]) {
      expect(releasePage(REPO, url)).toBe(`https://github.com/${REPO}/releases/latest`)
    }
  })
})

describe('fetchLatestRelease', () => {
  it('asks the releases API once, naming itself, and reads only the tag and the link', async () => {
    const fetch = vi.fn<UpdateFetch>(async () => release('v0.6.0'))
    const result = await fetchLatestRelease({ fetch, repository: REPO, currentVersion: '0.4.0' })
    expect(result).toEqual({
      ok: true,
      latest: 'v0.6.0',
      releaseUrl: `https://github.com/${REPO}/releases/tag/v0.6.0`
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(`https://api.github.com/repos/${REPO}/releases/latest`)
    expect(init?.method).toBe('GET')
    expect(init?.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Murmur/0.4.0'
    })
    // Nothing else goes with it: no body, no credentials.
    expect(init?.body).toBeUndefined()
  })

  it('says what went wrong, in words', async () => {
    const cases: Array<[Response | Error, string]> = [
      [reply(404, { message: 'Not Found' }), 'No published release was found on GitHub.'],
      [reply(403, { message: 'rate limit' }), 'GitHub is limiting requests from this network. Try again in an hour.'],
      [reply(429, {}), 'GitHub is limiting requests from this network. Try again in an hour.'],
      [reply(502, {}), 'GitHub answered with an error (HTTP 502). Try again later.'],
      [reply(200, 'not json'), "GitHub's answer could not be read. Try again later."],
      [reply(200, { tag_name: 'nightly' }), "GitHub's answer could not be read. Try again later."],
      [reply(200, { html_url: 'x' }), "GitHub's answer could not be read. Try again later."],
      [
        new TypeError('fetch failed'),
        'Could not reach GitHub. Check your internet connection and try again.'
      ]
    ]
    for (const [answer, error] of cases) {
      const fetch = vi.fn<UpdateFetch>(async () => {
        if (answer instanceof Error) throw answer
        return answer
      })
      expect(await fetchLatestRelease({ fetch, repository: REPO, currentVersion: '0.4.0' })).toEqual({
        ok: false,
        error
      })
    }
  })

  it('gives up after ten seconds', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn<UpdateFetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })
      )
      const pending = fetchLatestRelease({ fetch, repository: REPO, currentVersion: '0.4.0' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toEqual({
        ok: false,
        error: 'GitHub did not answer within 10 seconds. Try again later.'
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('UpdateChecker', () => {
  let enabled: boolean
  let lastCheckedAt: string | null
  let fetch: ReturnType<typeof vi.fn<UpdateFetch>>
  let statuses: ReturnType<UpdateChecker['getStatus']>[]

  const make = (currentVersion = '0.4.0'): UpdateChecker =>
    new UpdateChecker({
      fetch,
      repository: REPO,
      currentVersion,
      enabled: () => enabled,
      lastCheckedAt: () => lastCheckedAt,
      saveLastCheckedAt: (iso) => {
        lastCheckedAt = iso
      },
      onStatus: (status) => statuses.push(status)
    })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'))
    enabled = false
    lastCheckedAt = null
    statuses = []
    fetch = vi.fn<UpdateFetch>(async () => release('v0.6.0'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends nothing while switched off, however long it runs', async () => {
    const checker = make()
    checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 3 * CHECK_INTERVAL_MS)
    expect(fetch).not.toHaveBeenCalled()
    checker.stop()
  })

  it('checks a minute after startup when switched on, then no more than once a day', async () => {
    enabled = true
    const checker = make()
    checker.start()
    // Nothing at startup itself.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(1)

    // The hourly look finds nothing due for a day.
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - DUE_CHECK_TICK_MS)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DUE_CHECK_TICK_MS)
    expect(fetch).toHaveBeenCalledTimes(2)
    checker.stop()
  })

  it('does not check again at startup when the last check was within a day', async () => {
    enabled = true
    lastCheckedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const checker = make()
    checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 60 * 60 * 1000)
    expect(fetch).not.toHaveBeenCalled()
    checker.stop()
  })

  it('checks when switched on after a minute, and not at all when switched off again first', async () => {
    const checker = make()
    enabled = true
    checker.enabledChanged()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(fetch).toHaveBeenCalledTimes(1)

    lastCheckedAt = null
    checker.enabledChanged()
    enabled = false
    checker.enabledChanged()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS * 2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks now when asked, switched on or not, and remembers when', async () => {
    const checker = make()
    const status = await checker.checkNow()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(status).toMatchObject({ enabled: false, state: 'available', latest: 'v0.6.0' })
    expect(lastCheckedAt).toBe('2026-09-28T10:00:00.000Z')
    expect(checker.downloadPage()).toBe(`https://github.com/${REPO}/releases/tag/v0.6.0`)
    expect(statuses.map((entry) => entry.state)).toEqual(['checking', 'available'])
  })

  it('sends one request for two presses at once', async () => {
    const checker = make()
    const [first, second] = await Promise.all([checker.checkNow(), checker.checkNow()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })

  it('offers nothing when this is the latest version, or newer than the release', async () => {
    const same = make('0.6.0')
    expect((await same.checkNow()).state).toBe('latest')
    expect(same.downloadPage()).toBeNull()
    expect(updateResultText(same.getStatus())).toBe('You have the latest version (0.6.0).')

    const ahead = make('0.7.0-beta.1')
    expect((await ahead.checkNow()).state).toBe('latest')
  })

  it('reports a failed check, and offers nothing to open', async () => {
    fetch.mockResolvedValueOnce(reply(404, {}))
    const checker = make()
    const status = await checker.checkNow()
    expect(status).toMatchObject({
      state: 'error',
      error: 'No published release was found on GitHub.'
    })
    expect(checker.downloadPage()).toBeNull()
  })
})
