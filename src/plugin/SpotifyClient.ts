import type { DigestSettings } from './DigestSettings.js'

const SPOTIFY_CLIENT_ID = '3ef05bdfeab9409390644d8e7d84c1d1'
export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:42873/spotify-callback'

export interface SpotifyTrack {
  uri: string
  name: string
  artists: string[]
  album?: string
}

interface SpotifyTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

interface SpotifyDevice {
  id: string
  name: string
  type?: string
  is_active?: boolean
  is_restricted?: boolean
}

class SpotifyApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(`Spotify request failed (${status}): ${message}`)
    this.name = 'SpotifyApiError'
    this.status = status
  }
}

export class SpotifyClient {
  private settings: DigestSettings
  private save: () => Promise<void>

  constructor(settings: DigestSettings, save: () => Promise<void>) {
    this.settings = settings
    this.save = save
  }

  isConfigured(): boolean {
    return Boolean(SPOTIFY_CLIENT_ID)
  }

  isConnected(): boolean {
    return Boolean(this.settings.spotifyRefreshToken)
  }

  disconnect(): void {
    this.settings.spotifyAccessToken = ''
    this.settings.spotifyRefreshToken = ''
    this.settings.spotifyTokenExpiresAt = 0
    this.settings.spotifyConnectedUser = ''
  }

  async connectWithLoopback(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Set SPOTIFY_CLIENT_ID in SpotifyClient.ts before connecting Spotify.')
    }

    const redirect = new URL(SPOTIFY_REDIRECT_URI)

    const verifier = randomBase64Url(64)
    const challenge = await sha256Base64Url(verifier)
    const state = randomBase64Url(24)
    const server = await createLoopbackServer(redirect, state)

    const authUrl = new URL('https://accounts.spotify.com/authorize')
    authUrl.search = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
      scope: [
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state',
      ].join(' '),
    }).toString()

    window.open(authUrl.toString())

    try {
      const code = await server.waitForCode
      const token = await this.exchangeCode(code, verifier)
      this.applyToken(token)
      const profile = await this.getCurrentUser()
      this.settings.spotifyConnectedUser = profile
      await this.save()
    } finally {
      server.close()
    }
  }

  async searchTracks(query: string, limit = 5): Promise<SpotifyTrack[]> {
    const url = new URL('https://api.spotify.com/v1/search')
    url.search = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(Math.max(1, Math.min(10, limit))),
    }).toString()

    const body = await this.apiFetch(url.toString())
    const items = Array.isArray(body?.tracks?.items) ? body.tracks.items : []
    return items.map((item: any) => ({
      uri: item.uri,
      name: item.name,
      artists: Array.isArray(item.artists) ? item.artists.map((a: any) => a.name).filter(Boolean) : [],
      album: item.album?.name,
    })).filter((track: SpotifyTrack) => track.uri && track.name)
  }

  async playTrack(uri: string): Promise<void> {
    try {
      await this.startPlayback(uri)
    } catch (err) {
      if (!(err instanceof SpotifyApiError) || err.status !== 404) throw err
      const device = await this.activateBestDevice()
      await this.startPlayback(uri, device.id)
    }
  }

  async searchAndPlay(query: string): Promise<SpotifyTrack> {
    const tracks = await this.searchTracks(query, 5)
    if (tracks.length === 0) throw new Error(`No Spotify tracks found for "${query}".`)
    await this.playTrack(tracks[0].uri)
    return tracks[0]
  }

  private async getCurrentUser(): Promise<string> {
    const body = await this.apiFetch('https://api.spotify.com/v1/me')
    return body?.email || body?.display_name || body?.id || 'Spotify user'
  }

  private async startPlayback(uri: string, deviceId?: string): Promise<void> {
    const url = new URL('https://api.spotify.com/v1/me/player/play')
    if (deviceId) url.searchParams.set('device_id', deviceId)
    await this.apiFetch(url.toString(), {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri] }),
    })
  }

  private async activateBestDevice(): Promise<SpotifyDevice> {
    const body = await this.apiFetch('https://api.spotify.com/v1/me/player/devices')
    const devices = Array.isArray(body?.devices) ? body.devices as SpotifyDevice[] : []
    const usable = devices.filter(device => device.id && !device.is_restricted)
    const device = usable.find(d => d.is_active) || usable[0]
    if (!device) {
      throw new Error('No Spotify device is available. Open Spotify on this computer or phone, then try again.')
    }

    await this.apiFetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      body: JSON.stringify({
        device_ids: [device.id],
        play: false,
      }),
    })
    await sleep(500)
    return device
  }

  private async apiFetch(url: string, init: RequestInit = {}): Promise<any> {
    const token = await this.getAccessToken()
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    })

    if (response.status === 204) return null
    const text = await response.text()
    const body = parseJson(text)
    if (!response.ok) {
      const message = body?.error?.message || body?.error_description || text || response.statusText
      throw new SpotifyApiError(response.status, message)
    }
    return body
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isConnected()) throw new Error('Connect Spotify in Digest settings first.')
    if (this.settings.spotifyAccessToken && Date.now() < this.settings.spotifyTokenExpiresAt - 60_000) {
      return this.settings.spotifyAccessToken
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.settings.spotifyRefreshToken,
      client_id: SPOTIFY_CLIENT_ID,
    })
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const text = await response.text()
    const body = parseJson(text)
    if (!response.ok) {
      const message = body?.error_description || body?.error || text || response.statusText
      throw new Error(`Spotify token refresh failed (${response.status}): ${message}`)
    }

    this.applyToken(body as SpotifyTokenResponse)
    await this.save()
    return this.settings.spotifyAccessToken
  }

  private async exchangeCode(code: string, verifier: string): Promise<SpotifyTokenResponse> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: verifier,
      }),
    })
    const text = await response.text()
    const body = parseJson(text)
    if (!response.ok) {
      const message = body?.error_description || body?.error || text || response.statusText
      throw new Error(`Spotify token exchange failed (${response.status}): ${message}`)
    }
    return body as SpotifyTokenResponse
  }

  private applyToken(token: SpotifyTokenResponse): void {
    this.settings.spotifyAccessToken = token.access_token
    if (token.refresh_token) this.settings.spotifyRefreshToken = token.refresh_token
    this.settings.spotifyTokenExpiresAt = Date.now() + Math.max(1, token.expires_in) * 1000
  }
}

function parseJson(text: string): any {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function randomBase64Url(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function createLoopbackServer(redirect: URL, state: string): Promise<{
  waitForCode: Promise<string>
  close: () => void
}> {
  const http = require('http')
  const port = Number.parseInt(redirect.port || '80', 10)
  const host = redirect.hostname
  const expectedPath = redirect.pathname || '/'

  return new Promise((resolve, reject) => {
    let settled = false
    let timeout: number | null = null
    let resolveCode!: (code: string) => void
    let rejectCode!: (err: Error) => void
    const waitForCode = new Promise<string>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })

    const server = http.createServer((req: any, res: any) => {
      const requestUrl = new URL(req.url || '/', `${redirect.protocol}//${redirect.host}`)
      if (requestUrl.pathname !== expectedPath) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const returnedState = requestUrl.searchParams.get('state')
      const error = requestUrl.searchParams.get('error')
      const code = requestUrl.searchParams.get('code')

      res.writeHead(error || !code ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(error || !code
        ? '<p>Spotify sign-in failed. You can close this tab.</p>'
        : '<p>Spotify is connected. You can close this tab and return to Obsidian.</p>')

      if (error) rejectCode(new Error(error))
      else if (returnedState !== state) rejectCode(new Error('Spotify sign-in state did not match.'))
      else if (code) resolveCode(code)
      else rejectCode(new Error('Spotify did not return an authorization code.'))
    })

    server.on('error', (err: Error) => {
      if (!settled) {
        settled = true
        if (timeout) window.clearTimeout(timeout)
        reject(err)
      } else {
        rejectCode(err)
      }
    })

    server.listen(port, host, () => {
      settled = true
      timeout = window.setTimeout(() => {
        rejectCode(new Error('Spotify sign-in timed out.'))
        server.close()
      }, 180_000)

      resolve({
        waitForCode: waitForCode.finally(() => {
          if (timeout) window.clearTimeout(timeout)
        }),
        close: () => server.close(),
      })
    })
  })
}
