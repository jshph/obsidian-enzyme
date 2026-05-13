/**
 * EnzymeManager — wraps enzyme CLI operations.
 *
 * Centralizes all child_process calls for enzyme: install, login, init,
 * refresh, status, and config read/write. Used by DigestSettings for
 * the setup UI and DigestView for runtime checks.
 */

import * as TOML from 'smol-toml'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile as nodeExecFile, spawn } from 'child_process'
import { promisify } from 'util'

export interface EnzymeStatus {
  installed: boolean
  initialized: boolean
  loggedIn?: boolean
  email?: string
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

export interface LoginEvent {
  event: string
  verification_uri?: string
  email?: string
  message?: string
  opened_browser?: boolean
}

export interface EnzymeAccount {
  apiKey: string
  userId: string
  email: string
}

type PetriEntity = {
  name?: string
  catalysts?: Array<{ text?: string }>
}

type PetriResponse = {
  entities?: PetriEntity[]
}

type EnzymeTomlConfig = {
  vaults?: Record<string, Partial<EnzymeVaultConfig>>
}

const execFileAsync = promisify(nodeExecFile)
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export class EnzymeManager {
  private vaultPath: string
  private enzymeCommand: string | null = null

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath
  }

  async isInstalled(): Promise<boolean> {
    try {
      await this.exec(this.getEnzymeCommand(), ['--version'])
      return true
    } catch {
      return false
    }
  }

  isInitialized(): boolean {
    return fs.existsSync(path.join(this.vaultPath, '.enzyme', 'enzyme.db'))
  }

  getAccount(): EnzymeAccount | null {
    try {
      const auth = JSON.parse(fs.readFileSync(this.authPath(), 'utf-8'))
      if (!auth || typeof auth.api_key !== 'string') return null
      return {
        apiKey: auth.api_key,
        userId: typeof auth.user_id === 'string' ? auth.user_id : '',
        email: typeof auth.email === 'string' ? auth.email : '',
      }
    } catch {
      return null
    }
  }

  isLoggedIn(): boolean {
    return this.getAccount() !== null
  }

  async getStatus(): Promise<EnzymeStatus> {
    const installed = await this.isInstalled()
    if (!installed) return { installed: false, initialized: false }

    const account = this.getAccount()
    const initialized = this.isInitialized()
    if (!initialized) {
      return {
        installed: true,
        initialized: false,
        loggedIn: account !== null,
        email: account?.email,
        apiKey: account !== null,
      }
    }

    try {
      const { stdout } = await this.exec(this.getEnzymeCommand(), ['status', '-p', this.vaultPath])
      const status: EnzymeStatus = {
        installed: true,
        initialized: true,
        loggedIn: account !== null,
        email: account?.email,
      }

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

      status.apiKey = account !== null || (stdout.includes('API key:') && stdout.includes('configured'))

      return status
    } catch {
      return {
        installed: true,
        initialized: true,
        loggedIn: account !== null,
        email: account?.email,
        apiKey: account !== null,
      }
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

  async login(onEvent?: (event: LoginEvent) => void): Promise<void> {
    const cmd = this.getEnzymeCommand()

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, ['login', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let output = ''
      let stdoutBuf = ''
      let stderrBuf = ''

      const handleJsonLines = (chunk: Buffer) => {
        stdoutBuf += chunk.toString()
        const lines = stdoutBuf.split('\n')
        stdoutBuf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          output += `${line}\n`
          try {
            onEvent?.(JSON.parse(line) as LoginEvent)
          } catch {
            // Ignore non-JSON stdout from older enzyme binaries.
          }
        }
      }

      child.stdout.on('data', handleJsonLines)
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
        output += chunk.toString()
      })

      child.on('close', (code: number) => {
        if (stdoutBuf.trim()) {
          try {
            onEvent?.(JSON.parse(stdoutBuf.trim()) as LoginEvent)
          } catch {
            output += stdoutBuf
          }
        }

        if (code === 0) resolve()
        else {
          this.logCommandFailure(cmd, ['login', '--json'], output || stderrBuf, code)
          reject(new Error(this.extractUsefulError(output || stderrBuf, `enzyme login exited with code ${code}`)))
        }
      })

      child.on('error', (err: Error) => {
        console.error(`Failed to start ${cmd} login --json`, err)
        reject(err)
      })
    })
  }

  async init(onProgress?: (event: InitProgress) => void, env?: Record<string, string>): Promise<void> {
    const cmd = this.getEnzymeCommand()

    return new Promise((resolve, reject) => {
      const args = ['init', '-p', this.vaultPath, '--json-progress']
      const child = spawn(cmd, args, {
        env: this.getCommandEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // JSON progress events come on stderr
      let stderrBuf = ''
      let output = ''
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderrBuf += text
        output += text
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

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })

      child.on('close', (code: number) => {
        if (code === 0) resolve()
        else {
          this.logCommandFailure(cmd, args, output || stderrBuf, code)
          reject(new Error(this.extractUsefulError(output || stderrBuf, `enzyme init exited with code ${code}`)))
        }
      })

      child.on('error', (err: Error) => {
        console.error(`Failed to start ${cmd} ${args.join(' ')}`, err)
        reject(err)
      })
    })
  }

  async refresh(quiet = true, env?: Record<string, string>): Promise<void> {
    const cmd = this.getEnzymeCommand()
    const args = ['refresh', '-p', this.vaultPath]
    if (quiet) args.push('--quiet')

    return new Promise((resolve, reject) => {
      // Use spawn instead of execFile because enzyme refresh --quiet
      // may spawn background processes that inherit stdio. execFile
      // waits for all pipes to close, but spawn's 'close' event fires
      // when the main process exits.
      const child = spawn(cmd, args, {
        env: this.getCommandEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let output = ''
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })

      child.on('close', (code: number) => {
        if (code === 0) resolve()
        else {
          this.logCommandFailure(cmd, args, output, code)
          reject(new Error(this.extractUsefulError(output, `enzyme refresh exited with code ${code}`)))
        }
      })

      child.on('error', (err: Error) => {
        console.error(`Failed to start ${cmd} ${args.join(' ')}`, err)
        reject(err)
      })
    })
  }

  async getPetriOverview(limit = 20): Promise<string | undefined> {
    try {
      const { stdout } = await this.exec(
        this.getEnzymeCommand(),
        ['petri', '-p', this.vaultPath, '-n', String(limit)],
        15000,
      )
      const petri = JSON.parse(stdout) as PetriResponse
      const entities = (petri.entities || []).slice(0, limit)
      if (entities.length === 0) return undefined
      return entities.map(entity => {
        const catalysts = (entity.catalysts || [])
          .slice(0, 3)
          .map(catalyst => catalyst.text)
          .filter(Boolean)
          .join('; ')
        return `- ${entity.name || 'unknown'}: ${catalysts}`
      }).join('\n')
    } catch (err) {
      console.warn(`Failed to load Enzyme petri overview: ${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  async logout(): Promise<void> {
    await this.exec(this.getEnzymeCommand(), ['logout'], 30000)
  }

  /** Spawn a detached background refresh (fire-and-forget). */
  spawnBackgroundRefresh(env?: Record<string, string>): void {
    const cmd = this.getEnzymeCommand()
    const args = ['refresh', '--quiet', '-p', this.vaultPath]
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.getCommandEnv(env),
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('close', (code: number) => {
      if (code !== 0) this.logCommandFailure(cmd, args, output, code)
    })
    child.on('error', (err: Error) => {
      console.error(`Failed to start ${cmd} ${args.join(' ')}`, err)
    })
    child.unref()
  }

  readConfig(): EnzymeVaultConfig | null {
    const configPath = path.join(this.getHomeDir(), '.enzyme', 'config.toml')

    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      const parsed = TOML.parse(content) as EnzymeTomlConfig
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
    const configPath = path.join(this.getHomeDir(), '.enzyme', 'config.toml')

    try {
      let parsed: EnzymeTomlConfig = {}
      try {
        const content = fs.readFileSync(configPath, 'utf-8')
        parsed = TOML.parse(content) as EnzymeTomlConfig
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

  private getEnzymeCommand(): string {
    if (this.enzymeCommand) return this.enzymeCommand

    const home = this.getHomeDir()
    const candidates = [
      path.join(home, '.cargo', 'bin', 'enzyme'),
      path.join(home, '.local', 'bin', 'enzyme'),
      '/opt/homebrew/bin/enzyme',
      '/usr/local/bin/enzyme',
    ]

    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        this.enzymeCommand = candidate
        return candidate
      } catch {
        // Try the next preferred install location.
      }
    }

    this.enzymeCommand = 'enzyme'
    return this.enzymeCommand
  }

  private async exec(
    cmd: string,
    args: string[],
    timeout = 15000,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(cmd, args, { timeout })
  }

  private authPath(): string {
    const enzymeHome = path.join(this.getHomeDir(), '.enzyme')
    return path.join(enzymeHome, 'auth.json')
  }

  private extractUsefulError(output: string, fallback: string): string {
    const clean = output
      .split('\n')
      .map(line => line.replace(ANSI_ESCAPE_RE, '').trim())
      .filter(Boolean)
      .filter(line => !line.startsWith('{'))

    return clean.length > 0 ? clean[clean.length - 1] : fallback
  }

  private logCommandFailure(cmd: string, args: string[], output: string, code: number | null): void {
    const command = `${cmd} ${args.join(' ')}`
    const message = code === null
      ? `Enzyme command failed: ${command}`
      : `Enzyme command failed with code ${code}: ${command}`

    const clean = output
      .split('\n')
      .map(line => line.replace(ANSI_ESCAPE_RE, '').trimEnd())
      .filter(Boolean)
      .join('\n')

    if (clean) console.error(`${message}\n${clean}`)
    else console.error(message)
  }

  private async execStream(
    cmd: string,
    args: string[],
    onLine?: (line: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
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

  private getHomeDir(): string {
    return os.homedir()
  }

  private getCommandEnv(env?: Record<string, string>): Record<string, string> | undefined {
    if (!env) return undefined
    return {
      ...env,
      HOME: this.getHomeDir(),
    }
  }
}
