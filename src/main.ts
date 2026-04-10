import { resolve as resolvePath } from 'path'
import {
	Plugin,
	MarkdownPostProcessorContext,
	Notice,
	TFile,
	MarkdownView,
	FileSystemAdapter,
} from 'obsidian'
import { EnzymeDigestSettings, DEFAULT_SETTINGS, EnzymeDigestSettingTab } from './settings'
import { catalyzePool, enzymeRefresh, isVaultIndexed, isEnzymeInstalled, EnrichedResult } from './enzyme'
import { generateQueries, weaveDigest, DigestOutput } from './llm'
import { renderDigest, renderLoading, renderError, renderIdle, renderSetupNeeded } from './renderer'

type DigestFreq = 'hourly' | 'daily' | '3d' | 'weekly' | 'manual'

interface BlockConfig {
	prompt: string
	freq: DigestFreq
}

const MAX_CACHE_ENTRIES = 20
const MAX_POOL_FOR_LLM = 30
const LLM_TIMEOUT_MS = 90_000

function parseBlock(source: string): BlockConfig {
	const lines = source.trim().split('\n')
	let prompt = ''
	let freq: DigestFreq = 'daily'

	for (const line of lines) {
		const cleaned = line.trim().replace(/\s*#.*$/, '')
		if (cleaned.toLowerCase().startsWith('prompt:')) {
			prompt = cleaned.slice('prompt:'.length).trim()
		} else if (cleaned.toLowerCase().startsWith('freq:')) {
			freq = normalizeFreq(cleaned.slice('freq:'.length).trim())
		} else if (cleaned && !prompt) {
			prompt = lines
				.map((l) => l.trim().replace(/\s*#.*$/, ''))
				.filter((l) => l && !l.toLowerCase().startsWith('freq:'))
				.join(' ')
			break
		}
	}

	return { prompt, freq }
}

function normalizeFreq(raw: string): DigestFreq {
	const s = raw.toLowerCase().trim()
	if (s === 'hourly') return 'hourly'
	if (s === '3d' || s === '3 days') return '3d'
	if (s === 'weekly' || s === '1w' || s === '1 week') return 'weekly'
	if (s === 'manual') return 'manual'
	return 'daily'
}

function freqToMs(freq: DigestFreq): number | null {
	switch (freq) {
		case 'hourly': return 60 * 60 * 1000
		case 'daily': return 24 * 60 * 60 * 1000
		case '3d': return 3 * 24 * 60 * 60 * 1000
		case 'weekly': return 7 * 24 * 60 * 60 * 1000
		case 'manual': return null
	}
}

function shouldAutoRefresh(freq: DigestFreq, cacheTimestamp: number): boolean {
	const interval = freqToMs(freq)
	if (interval === null) return false
	return Date.now() - cacheTimestamp > interval
}

export function getVaultBasePath(app: { vault: { adapter: unknown } }): string {
	const adapter = app.vault.adapter
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : ''
}

export function toRelativeVaultPath(absPath: string, vaultRoot: string): string {
	if (vaultRoot && absPath.startsWith(vaultRoot)) {
		return absPath.slice(vaultRoot.length).replace(/^\//, '')
	}
	return absPath
}

export default class EnzymeDigestPlugin extends Plugin {
	settings: EnzymeDigestSettings = DEFAULT_SETTINGS
	private running = new Set<string>()
	private digestCache = new Map<string, { digest: DigestOutput; timestamp: number }>()

	async onload() {
		await this.loadSettings()

		this.addSettingTab(new EnzymeDigestSettingTab(this.app, this))

		this.registerMarkdownCodeBlockProcessor(
			'enzyme-digest',
			this.processDigestBlock.bind(this)
		)

		this.addCommand({
			id: 'insert-enzyme-digest',
			name: 'Insert Enzyme block',
			editorCallback: (editor) => {
				const selection = editor.getSelection()?.trim()
				const prompt = selection || this.settings.defaultPrompt
				const freq = this.settings.defaultFreq

				const block = [
					'```enzyme-digest',
					`prompt: ${prompt}`,
					`freq: ${freq}  # replace with: hourly | daily | 3d | weekly | manual`,
					'```',
					'',
				].join('\n')

				editor.replaceSelection(block)
			},
		})

		this.addCommand({
			id: 'refresh-enzyme-digests',
			name: 'Refresh Enzyme blocks on this page',
			callback: () => {
				this.digestCache.clear()
				const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)
				if (leaf) {
					leaf.previewMode?.rerender(true)
					new Notice('Refreshing enzyme blocks...')
				}
			},
		})

		this.scheduleEnzymeRefresh()
	}

	onunload() {
		this.digestCache.clear()
		this.running.clear()
	}

	getVaultPath(): string {
		const base = getVaultBasePath(this.app)
		const configured = this.settings.vaultPath
		if (!configured) return base
		if (configured.startsWith('/')) return configured
		// Resolve relative paths against the vault root
		return base ? resolvePath(base, configured) : configured
	}

	private scheduleEnzymeRefresh() {
		const checkInterval = 6 * 60 * 60 * 1000

		const maybeRefresh = async () => {
			const vaultPath = this.getVaultPath()
			if (!vaultPath || !isVaultIndexed(vaultPath)) return

			const intervalMs = this.settings.refreshIntervalDays * 24 * 60 * 60 * 1000
			const age = Date.now() - this.settings.lastRefreshTimestamp

			if (age > intervalMs) {
				try {
					await enzymeRefresh(vaultPath, this.settings)
					this.settings.lastRefreshTimestamp = Date.now()
					await this.saveSettings()
				} catch (e: unknown) {
					console.warn('enzyme-digest: background refresh failed', e)
				}
			}
		}

		// Delay initial check so we don't block startup
		const initialTimeout = window.setTimeout(() => maybeRefresh(), 10_000)
		this.register(() => window.clearTimeout(initialTimeout))

		this.registerInterval(
			window.setInterval(() => maybeRefresh(), checkInterval)
		)
	}

	async processDigestBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		if (!isEnzymeInstalled()) {
			renderSetupNeeded(el, 'not-installed')
			return
		}

		const vaultPath = this.getVaultPath()
		if (vaultPath && !isVaultIndexed(vaultPath)) {
			renderSetupNeeded(el, 'not-indexed')
			return
		}

		const config = parseBlock(source)

		if (!config.prompt) {
			renderIdle(el, '(no prompt set)', config.freq, () => {})
			return
		}

		const cached = this.digestCache.get(config.prompt)

		if (cached && !shouldAutoRefresh(config.freq, cached.timestamp)) {
			renderDigest(cached.digest, el, this.app, ctx.sourcePath)
			return
		}

		if (this.running.has(config.prompt)) {
			renderLoading(el, 'digest in progress...')
			return
		}

		if (config.freq === 'manual' && !cached) {
			renderIdle(el, config.prompt, config.freq, () => {
				this.runDigest(config, el, ctx)
			})
			return
		}

		await this.runDigest(config, el, ctx)
	}

	private enrichWithDates(pool: EnrichedResult[]): void {
		const vaultRoot = getVaultBasePath(this.app)

		for (const r of pool) {
			const relativePath = toRelativeVaultPath(r.file_path, vaultRoot)
			const file = this.app.vault.getAbstractFileByPath(relativePath)
			if (!(file instanceof TFile)) continue

			const cache = this.app.metadataCache.getFileCache(file)
			const createdRaw = cache?.frontmatter?.created
			if (createdRaw) {
				const dateMatch = String(createdRaw).match(/(\d{4}-\d{2}-\d{2})/)
				if (dateMatch) {
					r.created = dateMatch[1]
					continue
				}
			}

			// Fallback to ctime
			if (file.stat.ctime) {
				r.created = new Date(file.stat.ctime).toISOString().slice(0, 10)
			}
		}
	}

	private async runDigest(
		config: BlockConfig,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		if (!this.settings.apiKey) {
			renderError(el, 'No API key configured. Open Settings > Enzyme.')
			return
		}

		const effectiveSettings = { ...this.settings, vaultPath: this.getVaultPath() }
		this.running.add(config.prompt)

		try {
			renderLoading(el, 'generating search queries...')
			const queries = await generateQueries(config.prompt, effectiveSettings)

			renderLoading(el, `searching vault (${queries.length} queries)...`)
			let pool = await catalyzePool(queries, effectiveSettings)

			if (pool.length === 0) {
				renderError(el, 'No results from enzyme catalyze. Is your vault indexed?')
				return
			}

			this.enrichWithDates(pool)

			// Cap pool size to keep LLM prompt reasonable
			if (pool.length > MAX_POOL_FOR_LLM) {
				pool = pool.sort((a, b) => b.similarity - a.similarity).slice(0, MAX_POOL_FOR_LLM)
			}

			renderLoading(el, `weaving ${pool.length} highlights into digest...`)
			const digest = await weaveDigest(config.prompt, pool, effectiveSettings)

			// LRU eviction
			if (this.digestCache.size >= MAX_CACHE_ENTRIES) {
				const oldest = [...this.digestCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
				if (oldest) this.digestCache.delete(oldest[0])
			}
			this.digestCache.set(config.prompt, { digest, timestamp: Date.now() })

			renderDigest(digest, el, this.app, ctx.sourcePath)
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e)
			renderError(el, msg)
		} finally {
			this.running.delete(config.prompt)
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
