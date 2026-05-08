/**
 * EnzymeManager — wraps enzyme CLI operations.
 *
 * Centralizes all child_process calls for enzyme: install, login, init,
 * refresh, status, and config read/write. Used by DigestSettings for
 * the setup UI and DigestView for runtime checks.
 */

import * as TOML from 'smol-toml'

export interface EnzymeStatus {
  installed: boolean
  initialized: boolean
  documents?: number
  embedded?: number
  entities?: number
  catalysts?: number
  model?: string
  apiKey?: boolean
}

export interface EnzymeVaultConfig {
  entities: string[]
  excluded_tags: string[]
  excluded_links: string[]
  excluded_folders: string[]
}

export interface InitProgress {
  stage: string
  message: string
  progress?: number
  total?: number
}

export class EnzymeManager {
  private vaultPath: string

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath
  }

  async isInstalled(): Promise<boolean> {
    try {
      await this.exec('enzyme', ['--version'])
      return true
    } catch {
      return false
    }
  }

  isInitialized(): boolean {
    const fs = require('fs')
    const path = require('path')
    return fs.existsSync(path.join(this.vaultPath, '.enzyme', 'enzyme.db'))
  }

  async getStatus(): Promise<EnzymeStatus> {
    const installed = await this.isInstalled()
    if (!installed) return { installed: false, initialized: false }

    const initialized = this.isInitialized()
    if (!initialized) return { installed: true, initialized: false }

    try {
      const { stdout } = await this.exec('enzyme', ['status', '-p', this.vaultPath])
      const status: EnzymeStatus = { installed: true, initialized: true }

      // Parse "Documents:  6266" etc.
      const docMatch = stdout.match(/Documents:\s+(\d+)/)
      if (docMatch) status.documents = parseInt(docMatch[1])

      const embMatch = stdout.match(/Embedded:\s+(\d+)/)
      if (embMatch) status.embedded = parseInt(embMatch[1])

      const entMatch = stdout.match(/Entities:\s+(\d+)/)
      if (entMatch) status.entities = parseInt(entMatch[1])

      const catMatch = stdout.match(/Catalysts:\s+(\d+)/)
      if (catMatch) status.catalysts = parseInt(catMatch[1])

      const modelMatch = stdout.match(/Model:\s+(\S+)/)
      if (modelMatch) status.model = modelMatch[1]

      status.apiKey = stdout.includes('API key:') && stdout.includes('configured')

      return status
    } catch {
      return { installed: true, initialized: true }
    }
  }

  async install(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Downloading enzyme...')
    // Run install.sh — it handles platform detection, download, and setup
    await this.execStream(
      'bash',
      ['-c', 'curl -fsSL https://enzyme.garden/install.sh | bash'],
      onProgress,
    )
    onProgress?.('Enzyme installed.')
  }

  async login(): Promise<void> {
    // Device flow OAuth — opens browser, CLI handles polling
    await this.exec('enzyme', ['login', '-p', this.vaultPath], 300000)
  }

  async init(onProgress?: (event: InitProgress) => void): Promise<void> {
    const { spawn } = require('child_process')

    return new Promise((resolve, reject) => {
      const child = spawn('enzyme', ['init', '-p', this.vaultPath, '--json-progress'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // JSON progress events come on stderr
      let stderrBuf = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
        const lines = stderrBuf.split('\n')
        stderrBuf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as InitProgress
            onProgress?.(event)
          } catch {
            // Non-JSON stderr line, emit as message
            onProgress?.({ stage: 'info', message: line.trim() })
          }
        }
      })

      child.stdout.on('data', () => { /* discard stdout */ })

      child.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error(`enzyme init exited with code ${code}`))
      })

      child.on('error', (err: Error) => reject(err))
    })
  }

  async refresh(quiet = true): Promise<void> {
    const { spawn } = require('child_process')
    const args = ['refresh', '-p', this.vaultPath]
    if (quiet) args.push('--quiet')

    return new Promise((resolve, reject) => {
      // Use spawn instead of execFile because enzyme refresh --quiet
      // may spawn background processes that inherit stdio. execFile
      // waits for all pipes to close, but spawn's 'close' event fires
      // when the main process exits.
      const child = spawn('enzyme', args, {
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore'],
      })

      child.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error(`enzyme refresh exited with code ${code}`))
      })

      child.on('error', (err: Error) => reject(err))
    })
  }

  /** Spawn a detached background refresh (fire-and-forget). */
  spawnBackgroundRefresh(env?: Record<string, string>): void {
    const { spawn } = require('child_process')
    const child = spawn('enzyme', ['refresh', '--quiet', '-p', this.vaultPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...env },
    })
    child.on('error', (err: Error) => {
      console.warn('Failed to start enzyme background refresh:', err.message)
    })
    child.unref()
  }

  readConfig(): EnzymeVaultConfig | null {
    const fs = require('fs')
    const path = require('path')
    const configPath = path.join(process.env.HOME || '', '.enzyme', 'config.toml')

    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      const parsed = TOML.parse(content) as any
      const vaults = parsed.vaults || {}
      const vaultConfig = vaults[this.vaultPath]

      if (!vaultConfig) return null

      return {
        entities: Array.isArray(vaultConfig.entities) ? vaultConfig.entities : [],
        excluded_tags: Array.isArray(vaultConfig.excluded_tags) ? vaultConfig.excluded_tags : [],
        excluded_links: Array.isArray(vaultConfig.excluded_links) ? vaultConfig.excluded_links : [],
        excluded_folders: Array.isArray(vaultConfig.excluded_folders) ? vaultConfig.excluded_folders : [],
      }
    } catch {
      return null
    }
  }

  writeConfig(config: Partial<EnzymeVaultConfig>): void {
    const fs = require('fs')
    const path = require('path')
    const configPath = path.join(process.env.HOME || '', '.enzyme', 'config.toml')

    try {
      let parsed: any = {}
      try {
        const content = fs.readFileSync(configPath, 'utf-8')
        parsed = TOML.parse(content)
      } catch { /* file doesn't exist yet */ }

      if (!parsed.vaults) parsed.vaults = {}
      if (!parsed.vaults[this.vaultPath]) parsed.vaults[this.vaultPath] = {}

      const vc = parsed.vaults[this.vaultPath]
      if (config.entities !== undefined) vc.entities = config.entities
      if (config.excluded_tags !== undefined) vc.excluded_tags = config.excluded_tags
      if (config.excluded_links !== undefined) vc.excluded_links = config.excluded_links
      if (config.excluded_folders !== undefined) vc.excluded_folders = config.excluded_folders

      const dir = path.dirname(configPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(configPath, TOML.stringify(parsed))
    } catch (err) {
      console.error('Failed to write enzyme config:', err)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private async exec(
    cmd: string,
    args: string[],
    timeout = 15000,
  ): Promise<{ stdout: string; stderr: string }> {
    const { execFile } = require('child_process')
    const { promisify } = require('util')
    const execFileAsync = promisify(execFile)
    return execFileAsync(cmd, args, { timeout, env: process.env })
  }

  private async execStream(
    cmd: string,
    args: string[],
    onLine?: (line: string) => void,
  ): Promise<void> {
    const { spawn } = require('child_process')

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let buf = ''
      const handleData = (chunk: Buffer) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (line.trim()) onLine?.(line.trim())
        }
      }

      child.stdout.on('data', handleData)
      child.stderr.on('data', handleData)

      child.on('close', (code: number) => {
        if (buf.trim()) onLine?.(buf.trim())
        if (code === 0) resolve()
        else reject(new Error(`${cmd} exited with code ${code}`))
      })

      child.on('error', (err: Error) => reject(err))
    })
  }
}
