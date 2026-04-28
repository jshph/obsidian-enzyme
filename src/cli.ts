#!/usr/bin/env node

/**
 * Digest — token-efficient writing agent for Obsidian vaults.
 * Minimal REPL for testing. The real value is the SDK (core/).
 */

import { createInterface } from 'readline'
import { resolve } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'

import { Agent } from './core/agent.js'
import { createOpenAIProvider } from './core/providers/openai.js'
import type { LLMProvider } from './core/types.js'
import { buildSystemPrompt } from './prompt/system.js'
import { createVaultSearchTool } from './tools/vault-search.js'
import { createReadFileTool } from './tools/read-file.js'
import { createWriteFileTool } from './tools/write-file.js'
import { createEnzymePrefetch } from './context/prefetch.js'
import { initDebugLog } from './core/debug.js'

const execFileAsync = promisify(execFile)

const DEFAULT_MAX_CONTEXT = 32768

const USAGE = `
Usage: digest [vault-path] [options]

Arguments:
  vault-path                 Path to your Obsidian vault (default: current directory)

Options:
  --model <name>             Model name (overrides OPENAI_MODEL)
  --base-url <url>           API base URL (overrides OPENAI_BASE_URL)
  --max-context <tokens>     Max context window size (default: 32768)
  --enzyme-model <name>      Smaller model for enzyme catalyst generation (optional)
  --enzyme-base-url <url>    Base URL for enzyme model (optional)
  --guide <text>             Guide prompt for enzyme init (optional)
  --json-events              Emit JSONL events to stdout (for GUI integration)
  --help                     Show this help message

Environment variables:
  OPENAI_API_KEY              API key for OpenAI-compatible providers
  OPENAI_BASE_URL             Base URL (default: https://openrouter.ai/api/v1)
  OPENAI_MODEL                Model name (required if not passed via --model)
  DEBUG=1                     Enable debug logging
  DEBUG_FILE                  Debug log path (default: debug.jsonl)

Examples:
  # Set up once, then just run digest in your vault
  export OPENAI_API_KEY=sk-or-...
  export OPENAI_BASE_URL=https://openrouter.ai/api/v1
  export OPENAI_MODEL=zai-org/glm-4.7-flash
  cd ~/vault && npx @jshph/digest

  # Or specify a vault path
  npx @jshph/digest ~/vault

  # Local (LM Studio)
  npx @jshph/digest --base-url http://localhost:1234/v1 --model qwen/qwen3.5-9b --enzyme-model lmstudio-community/Qwen3-0.6B-GGUF
`.trim()

function parseArgs(argv: string[]) {
  const args = argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    process.exit(0)
  }

  let vaultPath = ''
  let model = process.env.OPENAI_MODEL || ''
  let baseURL = process.env.OPENAI_BASE_URL || ''
  let maxContext = DEFAULT_MAX_CONTEXT
  let enzymeModel = ''
  let enzymeBaseURL = ''
  let guide = ''
  let jsonEvents = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--model':
        model = args[++i]; break
      case '--base-url':
        baseURL = args[++i]; break
      case '--max-context':
        maxContext = parseInt(args[++i], 10); break
      case '--enzyme-model':
        enzymeModel = args[++i]; break
      case '--enzyme-base-url':
        enzymeBaseURL = args[++i]; break
      case '--guide':
        guide = args[++i]; break
      case '--json-events':
        jsonEvents = true; break
      default:
        if (args[i].startsWith('--')) {
          console.error(`Unknown option: ${args[i]}\n`)
          console.error(USAGE)
          process.exit(1)
        }
        // First positional arg is vault path
        if (!vaultPath) vaultPath = args[i]
    }
  }

  // Default vault path: ENZYME_VAULT_ROOT > positional arg > cwd
  if (!vaultPath) vaultPath = process.env.ENZYME_VAULT_ROOT || process.cwd()

  // Validate required args
  const errors: string[] = []

  if (!existsSync(vaultPath)) {
    errors.push(`Vault path does not exist: ${vaultPath}`)
  }

  if (!model) {
    errors.push('No model specified. Set OPENAI_MODEL or use --model <name>')
  }

  if (isNaN(maxContext) || maxContext < 1024) {
    errors.push(`Invalid --max-context: must be a number >= 1024`)
  }

  if (errors.length > 0) {
    console.error(errors.map(e => `Error: ${e}`).join('\n') + '\n')
    console.error(USAGE)
    process.exit(1)
  }

  // Default base URL
  if (!baseURL) baseURL = 'https://openrouter.ai/api/v1'

  return { vaultPath: resolve(vaultPath), model, baseURL, maxContext, enzymeModel, enzymeBaseURL, guide, jsonEvents }
}

async function main() {
  const { vaultPath, model, baseURL, maxContext, enzymeModel, enzymeBaseURL, guide, jsonEvents } = parseArgs(process.argv)

  const isTTYBanner = process.stderr.isTTY
  const dim = (s: string) => isTTYBanner ? `\x1b[2m${s}\x1b[0m` : s

  if (process.env.DEBUG) {
    const debugPath = resolve(process.env.DEBUG_FILE || 'debug.jsonl')
    await initDebugLog(debugPath)
    process.stderr.write(dim(`debug: ${debugPath}\n`))
  }
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
  process.stderr.write(`digest v${pkg.version} ${dim(`· ${model} · ${maxContext} tokens`)}\n`)
  process.stderr.write(dim(`vault: ${vaultPath}\n`))

  // ── Enzyme startup ────────────────────────────────────────────
  //
  // 1. If `enzyme` binary isn't available, install it
  // 2. If .enzyme/enzyme.db doesn't exist, run `enzyme init --quiet`
  // 3. If already initialized, run `enzyme petri` for the overview.

  let enzymeOverview: string | undefined
  const enzymeDb = resolve(vaultPath, '.enzyme', 'enzyme.db')

  // Check if enzyme is installed, prompt to install if not
  let enzymeAvailable = false
  try {
    await execFileAsync('enzyme', ['--version'], { timeout: 5_000 })
    enzymeAvailable = true
  } catch {
    // Enzyme not found — explain and ask before installing
    process.stderr.write('\n')
    process.stderr.write(dim('  Enzyme compiles your vault into a concept graph so agents\n'))
    process.stderr.write(dim('  don\'t get lost in your workspace. 8ms on-device semantic\n'))
    process.stderr.write(dim('  queries, 80% fewer tokens. Local, free for individuals.\n'))
    process.stderr.write(dim('  https://enzyme.garden\n'))
    process.stderr.write('\n')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await new Promise<string>(resolve => {
      rl.question(dim('enzyme: not found. Install? (Y/n) '), resolve)
    })
    rl.close()
    if (answer.trim().toLowerCase() !== 'n') {
      process.stderr.write(dim('enzyme: installing via enzyme.garden...\n'))
      try {
        await execFileAsync('bash', ['-c', 'curl -fsSL enzyme.garden/install.sh | bash'], { timeout: 60_000 })
        await execFileAsync('enzyme', ['--version'], { timeout: 5_000 })
        enzymeAvailable = true
        process.stderr.write(dim('enzyme: installed\n'))
      } catch {
        process.stderr.write(dim('enzyme: install failed\n'))
      }
    } else {
      process.stderr.write(dim('enzyme: skipped\n'))
    }
  }

  function formatPetriEntities(entities: any[]): string {
    return entities
      .map((e: any) => {
        const cats = (e.catalysts || []).slice(0, 3).map((c: any) => c.text).join('; ')
        return `- ${e.name}: ${cats}`
      })
      .join('\n')
  }

  // Resolve guide: --guide flag takes priority, then guide.md in vault root
  let resolvedGuide = guide
  if (!resolvedGuide) {
    const guidePath = resolve(vaultPath, 'guide.md')
    try {
      resolvedGuide = await readFile(guidePath, 'utf-8')
    } catch { /* no guide.md */ }
  }

  // Build enzyme env: reuse Digest's LLM config for catalyst generation.
  // Enzyme reads OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL (OpenAI-compat).
  // Prefer enzyme model (cheaper/smaller) for catalysts, fall back to main model.
  const enzymeEnv: Record<string, string> = { ...process.env as Record<string, string> }
  const resolvedEnzymeModel = enzymeModel || model
  const resolvedEnzymeBaseURL = enzymeModel
    ? (enzymeBaseURL || baseURL)
    : baseURL
  if (resolvedEnzymeBaseURL) enzymeEnv.OPENAI_BASE_URL = resolvedEnzymeBaseURL
  if (resolvedEnzymeModel) enzymeEnv.OPENAI_MODEL = resolvedEnzymeModel

  if (enzymeAvailable && !existsSync(enzymeDb)) {
    // Vault not initialized — run enzyme init
    try {
      const initArgs = ['init', '--quiet', '-p', vaultPath]
      if (resolvedGuide) initArgs.push('--guide', resolvedGuide)
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      let frame = 0
      const start = Date.now()
      process.stderr.write(dim(`enzyme: initializing vault ${frames[0]}`))
      const spinner = setInterval(() => {
        frame = (frame + 1) % frames.length
        const secs = ((Date.now() - start) / 1000).toFixed(0)
        process.stderr.write(`\r${dim(`enzyme: initializing vault ${frames[frame]} ${secs}s`)}`)
      }, 100)
      let stdout: string
      try {
        ({ stdout } = await execFileAsync('enzyme', initArgs, { timeout: 120_000, env: enzymeEnv }))
      } finally {
        clearInterval(spinner)
        process.stderr.write('\r\x1b[K') // clear spinner line
      }
      const result = JSON.parse(stdout)
      // --quiet init output includes petri under the `petri` key
      const petri = result.petri || result
      const entities = (petri.entities || []).slice(0, 20)
      if (entities.length > 0) {
        enzymeOverview = formatPetriEntities(entities)
        process.stderr.write(dim(`enzyme: initialized, ${entities.length} entities\n`))
      } else {
        process.stderr.write(dim('enzyme: initialized (no entities yet)\n'))
      }
    } catch (err: any) {
      // If init partially created the db but failed (e.g. mid-catalyst),
      // remove it so next startup retries init instead of using stale state.
      try { if (existsSync(enzymeDb)) await unlink(enzymeDb) } catch { /* best effort */ }
      const detail = err?.stderr || err?.message || String(err)
      process.stderr.write(dim(`enzyme: init failed — ${detail}\n`))
    }
  } else if (enzymeAvailable) {
    // Already initialized — get petri overview
    try {
      const { stdout } = await execFileAsync('enzyme', ['petri', '-p', vaultPath, '-n', '20'], { timeout: 15_000 })
      const petri = JSON.parse(stdout)
      const entities = (petri.entities || []).slice(0, 20)
      enzymeOverview = formatPetriEntities(entities)
      process.stderr.write(dim(`enzyme: ${entities.length} entities indexed\n`))
    } catch (err: any) {
      const detail = err?.stderr || err?.message || String(err)
      process.stderr.write(dim(`enzyme: petri failed — ${detail}\n`))
    }
  }

  // Load memory if it exists
  let memoryContent: string | undefined
  try {
    const memPath = resolve(vaultPath, '.digest', 'memory', 'MEMORY.md')
    memoryContent = await readFile(memPath, 'utf-8')
    // Cap at 200 lines (same as Claude Code)
    const lines = memoryContent.split('\n')
    if (lines.length > 200) {
      memoryContent = lines.slice(0, 200).join('\n') + '\n[truncated]'
    }
  } catch { /* no memory file */ }

  const systemPrompt = buildSystemPrompt({
    vaultName: vaultPath.split('/').pop(),
    enzymeOverview,
    memoryContent,
  })

  const promptTokens = systemPrompt.reduce((sum, b) => sum + Math.ceil(b.text.length / 3.5), 0)
  process.stderr.write(dim(`prompt: ~${promptTokens} tokens · ~${maxContext - promptTokens - 1400} available\n`))

  const maxTokens = Math.min(2048, Math.floor(maxContext * 0.25))

  const provider: LLMProvider = createOpenAIProvider({
    baseURL,
    model,
    maxTokens,
    apiKey: process.env.OPENAI_API_KEY,
  })
  process.stderr.write(dim(`endpoint: ${baseURL}\n`))

  // Tools — VaultSearch is the primary search tool (semantic, via enzyme).
  // TextSearch (grep for #tags) removed: 9B models misuse it for concepts,
  // and VaultSearch covers those better with richer results.
  const tools = [
    createVaultSearchTool(vaultPath),
    createReadFileTool(vaultPath),
    createWriteFileTool(vaultPath),
  ]

  const agent = new Agent({
    systemPrompt,
    tools,
    provider,
    context: {
      maxTokens: maxContext,
      compactThreshold: 0.70,
      keepRecentToolResults: 2,
    },
    prefetch: createEnzymePrefetch(vaultPath),
  })

  // Pre-warm the model with the system prompt while user thinks
  // about their first message. ~2,700 tokens cached before they type.
  if (provider.warmup) provider.warmup(systemPrompt, [])

  // ── Terminal UI ──────────────────────────────────────────────────
  //
  // ANSI colors (no dependencies). Minimal, color-coded output:
  //   dim     — system info (prefetch, turn stats)
  //   cyan    — tool names
  //   yellow  — tool queries/args
  //   red     — errors
  //   default — model response text

  const isTTY = process.stdout.isTTY
  const c = {
    dim:     (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
    cyan:    (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
    yellow:  (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
    red:     (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
    green:   (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
    bold:    (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  }

  // ── Background enzyme refresh ─────────────────────────────────
  //
  // After each prompt completes, spawn `enzyme refresh --quiet` as a
  // detached child. The fast path does cheap local work (index, embed,
  // similarity) then spawns its own background process for expensive
  // LLM catalyst regen if stale. We detach + unref so:
  //   - REPL mode: refresh runs while user thinks about next prompt
  //   - Piped mode: refresh survives process exit
  let refreshRunning = false
  function spawnEnzymeRefresh() {
    if (refreshRunning) return
    refreshRunning = true
    const child = spawn('enzyme', ['refresh', '--quiet', '-p', vaultPath], {
      detached: true,
      stdio: 'ignore',
      env: enzymeEnv,
    })
    child.on('exit', () => { refreshRunning = false })
    child.on('error', () => { refreshRunning = false })
    child.unref()
  }

  let sessionTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let turnCount = 0
  let currentToolCalls: { name: string; id: string; args: string }[] = []

  // Braille spinner while waiting for first output after prompt
  const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let waitSpinner: ReturnType<typeof setInterval> | null = null
  function startWaitSpinner() {
    if (!isTTY) return
    let frame = 0
    process.stderr.write(`  ${brailleFrames[0]}`)
    waitSpinner = setInterval(() => {
      frame = (frame + 1) % brailleFrames.length
      process.stderr.write(`\r  ${brailleFrames[frame]}`)
    }, 80)
  }
  function stopWaitSpinner() {
    if (waitSpinner) {
      clearInterval(waitSpinner)
      waitSpinner = null
      process.stderr.write('\r\x1b[K')
    }
  }

  // Timing
  let promptStartTime = 0       // when user hits enter
  let turnStartTime = 0         // when a turn begins
  let firstTokenTime = 0        // first text_delta of synthesis
  let firstTokenEmitted = false  // track per prompt

  const elapsed = (from: number) => {
    const ms = Date.now() - from
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  }

  // ── JSON events mode ───────────────────────────────────────────────
  //
  // When --json-events is passed, emit structured JSONL to stdout.
  // Each line is a self-contained JSON object. The GUI reads these
  // to render tool calls, token usage, and streaming text separately.
  //
  // Event types:
  //   {"type":"status","text":"..."}              — startup info
  //   {"type":"agent_start"}                      — prompt processing begins
  //   {"type":"tool_call","name":"...","query":"..."}
  //   {"type":"tool_result","name":"...","tokens":N,"error":bool}
  //   {"type":"text_delta","text":"..."}          — streaming token
  //   {"type":"turn_end","usage":{...},"elapsed":"..."}
  //   {"type":"agent_end","usage":{...},"elapsed":"..."}
  //   {"type":"error","message":"..."}

  const emit = (obj: Record<string, unknown>) =>
    process.stdout.write(JSON.stringify(obj) + '\n')

  if (jsonEvents) {
    emit({ type: 'status', text: `digest v${pkg.version}`, model, maxContext, vault: vaultPath })
    if (enzymeOverview) emit({ type: 'status', text: `enzyme: initialized` })

    agent.on((event) => {
      switch (event.type) {
        case 'agent_start':
          promptStartTime = Date.now()
          firstTokenEmitted = false
          emit({ type: 'agent_start' })
          break

        case 'prefetch_start':
          emit({ type: 'prefetch', source: event.source })
          break
        case 'prefetch_end':
          break

        case 'tool_call_start': {
          const query = (event.args.query as string) || (event.args.path as string) || ''
          currentToolCalls.push({ name: event.name, id: event.id, args: query.slice(0, 120) })
          emit({ type: 'tool_call', name: event.name, query: query.slice(0, 120) })
          break
        }
        case 'tool_call_end': {
          const tokens = Math.ceil(event.result.content.length / 3.5)
          emit({
            type: 'tool_result',
            name: event.name,
            tokens,
            error: event.result.isError,
          })
          break
        }

        case 'turn_start':
          turnStartTime = Date.now()
          break

        case 'turn_end':
          turnCount++
          currentToolCalls = []
          if (event.usage) {
            sessionTokens.input += event.usage.inputTokens
            sessionTokens.output += event.usage.outputTokens
            sessionTokens.cacheRead += event.usage.cacheReadTokens || 0
            sessionTokens.cacheWrite += event.usage.cacheWriteTokens || 0
            emit({
              type: 'turn_end',
              turn: turnCount,
              usage: event.usage,
              elapsed: elapsed(turnStartTime),
            })
          }
          break

        case 'text_delta':
          if (!firstTokenEmitted) {
            firstTokenEmitted = true
            firstTokenTime = Date.now()
            emit({ type: 'first_token', elapsed: elapsed(promptStartTime) })
          }
          emit({ type: 'text_delta', text: event.text })
          break

        case 'compact_start':
          emit({ type: 'compact' })
          break
        case 'compact_end':
          break

        case 'error':
          emit({ type: 'error', message: event.error })
          break

        case 'agent_end':
          emit({
            type: 'agent_end',
            usage: { ...sessionTokens },
            elapsed: elapsed(promptStartTime),
          })
          spawnEnzymeRefresh()
          break
      }
    })
  } else {
    // ── Standard ANSI terminal output ─────────────────────────────────

    agent.on((event) => {
      switch (event.type) {
        case 'agent_start':
          promptStartTime = Date.now()
          firstTokenEmitted = false
          startWaitSpinner()
          break

        case 'prefetch_start':
          break
        case 'prefetch_end':
          break

        case 'tool_call_start': {
          stopWaitSpinner()
          const query = (event.args.query as string) || (event.args.path as string) || ''
          const preview = query.slice(0, 80)
          currentToolCalls.push({ name: event.name, id: event.id, args: preview })
          break
        }
        case 'tool_call_end': {
          const tokens = Math.ceil(event.result.content.length / 3.5)
          const call = currentToolCalls.find(t => t.id === event.id)
          if (event.result.isError) {
            process.stderr.write(c.red(`  ✗ ${event.name}: ${event.result.content.slice(0, 80)}\n`))
          } else {
            process.stderr.write(
              `  ${c.cyan(event.name)} ${c.yellow(call?.args || '')}` +
              c.dim(` → ${tokens} tokens\n`),
            )
          }
          break
        }

        case 'turn_start':
          turnStartTime = Date.now()
          break

        case 'turn_end':
          turnCount++
          currentToolCalls = []
          if (event.usage) {
            sessionTokens.input += event.usage.inputTokens
            sessionTokens.output += event.usage.outputTokens
            sessionTokens.cacheRead += event.usage.cacheReadTokens || 0
            sessionTokens.cacheWrite += event.usage.cacheWriteTokens || 0
            const cached = event.usage.cacheReadTokens || 0
            const turnTime = elapsed(turnStartTime)
            process.stderr.write(c.dim(
              `  ─ turn ${turnCount}: ${event.usage.inputTokens} in → ${event.usage.outputTokens} out` +
              (cached > 0 ? ` (${cached} cached)` : '') +
              ` ${turnTime}\n`,
            ))
          }
          break

        case 'text_delta':
          stopWaitSpinner()
          if (!firstTokenEmitted) {
            firstTokenEmitted = true
            firstTokenTime = Date.now()
            process.stderr.write(c.green(`  ⚡ first token: ${elapsed(promptStartTime)}\n`))
          }
          process.stdout.write(event.text)
          break

        case 'compact_start':
          process.stderr.write(c.dim('  ◇ compacting context...\n'))
          break
        case 'compact_end':
          process.stderr.write(c.dim('  ◇ compacted\n'))
          break

        case 'error':
          stopWaitSpinner()
          process.stderr.write(c.red(`\n  ✗ ${event.error}\n`))
          break

        case 'agent_end': {
          const totalTime = elapsed(promptStartTime)
          process.stderr.write(c.dim(
            `  ═ ${sessionTokens.input} in, ${sessionTokens.output} out` +
            (sessionTokens.cacheRead > 0 ? ` (${sessionTokens.cacheRead} cached)` : '') +
            ` · ${totalTime}\n`,
          ))
          process.stdout.write('\n')
          spawnEnzymeRefresh()
          break
        }
      }
    })
  }

  // JSON events mode: read stdin line by line, process each as a prompt.
  // Multi-turn — stays alive between prompts.
  if (jsonEvents) {
    const rl = createInterface({ input: process.stdin })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed === '/quit' || trimmed === '/exit') break
      await agent.prompt(trimmed)
    }
    process.exit(0)
  }

  // Piped mode: read all stdin, process the first non-empty line, exit.
  // Interactive mode: REPL loop.
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (trimmed) await agent.prompt(trimmed)
    }
    process.exit(0)
  }

  process.stderr.write('\n')
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[32m❯\x1b[0m ',
  })

  rl.prompt()
  rl.on('line', async (line) => {
    const input = line.trim()
    if (!input) { rl.prompt(); return }
    if (input === '/quit' || input === '/exit') { rl.close(); return }
    if (input === '/context') {
      const msgs = agent.getMessages()
      console.log(`Messages: ${msgs.length}`)
      console.log(`Est. tokens: ~${Math.ceil(JSON.stringify(msgs).length / 3.5)}`)
      rl.prompt()
      return
    }
    await agent.prompt(input)
    rl.prompt()
  })
  rl.on('close', () => process.exit(0))
}

main().catch(err => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
