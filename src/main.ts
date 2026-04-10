import { Plugin, MarkdownPostProcessorContext, Notice } from 'obsidian'
import { EnzymeDigestSettings, DEFAULT_SETTINGS, EnzymeDigestSettingTab } from './settings'
import { catalyzePool, enzymeRefresh, isVaultIndexed } from './enzyme'
import { generateQueries, weaveDigest, DigestOutput } from './llm'
import { renderDigest, renderLoading, renderError, renderIdle } from './renderer'

interface BlockConfig {
	prompt: string
	freq: string
}

// Simple cache keyed by prompt text
const digestCache = new Map<string, { digest: DigestOutput; timestamp: number }>()

function parseBlock(source: string): BlockConfig {
	const lines = source.trim().split('\n')
	let prompt = ''
	let freq = 'daily'

	for (const line of lines) {
		const trimmed = line.trim()
		// Strip inline comments (# ...)
		const withoutComment = trimmed.replace(/\s*#.*$/, '')
		if (withoutComment.toLowerCase().startsWith('prompt:')) {
			prompt = withoutComment.slice('prompt:'.length).trim()
		} else if (withoutComment.toLowerCase().startsWith('freq:')) {
			freq = withoutComment.slice('freq:'.length).trim()
		} else if (withoutComment && !prompt) {
			// If no prefix, treat non-comment content as the prompt
			prompt = lines
				.map((l) => l.trim().replace(/\s*#.*$/, ''))
				.filter((l) => l && !l.toLowerCase().startsWith('freq:'))
				.join(' ')
			break
		}
	}

	return { prompt, freq }
}

function parseFreqToMs(freq: string): number | null {
	const normalized = freq.trim().toLowerCase()
	switch (normalized) {
		case 'hourly':
			return 60 * 60 * 1000
		case 'daily':
			return 24 * 60 * 60 * 1000
		case '3d':
		case '3 days':
			return 3 * 24 * 60 * 60 * 1000
		case 'weekly':
		case '1w':
		case '1 week':
			return 7 * 24 * 60 * 60 * 1000
		case 'manual':
			return null
		default:
			return 24 * 60 * 60 * 1000
	}
}

function shouldAutoRefresh(freq: string, cacheTimestamp: number | undefined): boolean {
	if (!cacheTimestamp) return false
	const interval = parseFreqToMs(freq)
	if (interval === null) return false
	return Date.now() - cacheTimestamp > interval
}

export default class EnzymeDigestPlugin extends Plugin {
	settings: EnzymeDigestSettings = DEFAULT_SETTINGS
	private running = new Set<string>()
	private refreshIntervalId: number | null = null

	async onload() {
		await this.loadSettings()

		this.addSettingTab(new EnzymeDigestSettingTab(this.app, this))

		// Register the code fence processor
		this.registerMarkdownCodeBlockProcessor(
			'enzyme-digest',
			this.processDigestBlock.bind(this)
		)

		// Command to insert a digest block — uses selected text as prompt if available
		this.addCommand({
			id: 'insert-enzyme-digest',
			name: 'Insert Enzyme Digest block',
			editorCallback: (editor) => {
				const selection = editor.getSelection()?.trim()
				const prompt = selection || this.settings.defaultPrompt
				const freq = 'daily'

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

		// Command to refresh all digest blocks on the current page
		this.addCommand({
			id: 'refresh-enzyme-digests',
			name: 'Refresh all Enzyme Digest blocks on this page',
			callback: () => {
				digestCache.clear()
				const leaf = this.app.workspace.getActiveViewOfType(
					(require('obsidian') as any).MarkdownView
				)
				if (leaf) {
					leaf.previewMode?.rerender(true)
					new Notice('Refreshing enzyme digests...')
				}
			},
		})

		// Schedule periodic enzyme refresh on vault open
		this.scheduleEnzymeRefresh()
	}

	onunload() {
		if (this.refreshIntervalId !== null) {
			window.clearInterval(this.refreshIntervalId)
		}
	}

	getVaultPath(): string {
		return this.settings.vaultPath || (this.app.vault.adapter as any).basePath || ''
	}

	private scheduleEnzymeRefresh() {
		// Check once on load, then every 6 hours
		const checkInterval = 6 * 60 * 60 * 1000

		const maybeRefresh = async () => {
			const vaultPath = this.getVaultPath()
			if (!vaultPath || !isVaultIndexed(vaultPath)) return

			const intervalMs = this.settings.refreshIntervalDays * 24 * 60 * 60 * 1000
			const age = Date.now() - this.settings.lastRefreshTimestamp

			if (age > intervalMs) {
				try {
					await enzymeRefresh(vaultPath)
					this.settings.lastRefreshTimestamp = Date.now()
					await this.saveSettings()
				} catch {
					// Silent — background refresh, don't interrupt the user
				}
			}
		}

		// Run once after app is ready (slight delay to not block startup)
		setTimeout(() => maybeRefresh(), 10_000)

		// Then periodically
		this.refreshIntervalId = window.setInterval(
			() => maybeRefresh(),
			checkInterval
		) as unknown as number
		this.registerInterval(this.refreshIntervalId)
	}

	async processDigestBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		const config = parseBlock(source)

		if (!config.prompt) {
			renderIdle(el, '(no prompt set)', config.freq, () => {})
			return
		}

		// Check cache
		const cached = digestCache.get(config.prompt)
		const needsRefresh = cached
			? shouldAutoRefresh(config.freq, cached.timestamp)
			: true

		if (cached && !needsRefresh) {
			renderDigest(cached.digest, el, this.app, ctx.sourcePath)
			return
		}

		// Prevent duplicate runs
		if (this.running.has(config.prompt)) {
			renderLoading(el, 'digest in progress...')
			return
		}

		// For manual freq with no cache, show idle state with run button
		if (config.freq === 'manual' && !cached) {
			renderIdle(el, config.prompt, config.freq, () => {
				this.runDigest(config, el, ctx)
			})
			return
		}

		// Auto-run for daily/weekly/etc, or manual with stale cache
		await this.runDigest(config, el, ctx)
	}

	private getEffectiveSettings(): EnzymeDigestSettings {
		const s = { ...this.settings }
		if (!s.vaultPath) {
			s.vaultPath = (this.app.vault.adapter as any).basePath || ''
		}
		return s
	}

	private async runDigest(
		config: BlockConfig,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		if (!this.settings.apiKey) {
			renderError(el, 'No API key configured. Open Settings > Enzyme Digest.')
			return
		}

		const effectiveSettings = this.getEffectiveSettings()
		this.running.add(config.prompt)

		try {
			// Stage 1: Generate queries
			renderLoading(el, 'generating search queries...')
			const queries = await generateQueries(config.prompt, effectiveSettings)

			// Stage 2: Parallel enzyme catalyze
			renderLoading(el, `searching vault (${queries.length} queries)...`)
			const pool = await catalyzePool(queries, effectiveSettings)

			if (pool.length === 0) {
				renderError(el, 'No results from enzyme catalyze. Is your vault indexed?')
				return
			}

			// Stage 3: Weave into digest
			renderLoading(el, `weaving ${pool.length} highlights into digest...`)
			const digest = await weaveDigest(config.prompt, pool, effectiveSettings)

			// Cache
			digestCache.set(config.prompt, { digest, timestamp: Date.now() })

			// Render
			renderDigest(digest, el, this.app, ctx.sourcePath)
		} catch (e: any) {
			renderError(el, e.message || String(e))
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
