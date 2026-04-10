import { Plugin, MarkdownPostProcessorContext, Notice } from 'obsidian'
import { EnzymeDigestSettings, DEFAULT_SETTINGS, EnzymeDigestSettingTab } from './settings'
import { catalyzePool } from './enzyme'
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
	let freq = 'manual'

	for (const line of lines) {
		const trimmed = line.trim()
		if (trimmed.toLowerCase().startsWith('prompt:')) {
			prompt = trimmed.slice('prompt:'.length).trim()
		} else if (trimmed.toLowerCase().startsWith('freq:')) {
			freq = trimmed.slice('freq:'.length).trim()
		} else if (trimmed && !prompt) {
			// If no prefix, treat the whole content as the prompt
			prompt = lines
				.filter((l) => !l.trim().toLowerCase().startsWith('freq:'))
				.map((l) => l.trim())
				.join(' ')
			break
		}
	}

	return { prompt, freq }
}

function shouldAutoRefresh(freq: string, cacheTimestamp: number | undefined): boolean {
	if (!cacheTimestamp) return false
	const now = Date.now()
	const age = now - cacheTimestamp

	switch (freq) {
		case 'daily':
			return age > 24 * 60 * 60 * 1000
		case 'weekly':
			return age > 7 * 24 * 60 * 60 * 1000
		default:
			return false
	}
}

export default class EnzymeDigestPlugin extends Plugin {
	settings: EnzymeDigestSettings = DEFAULT_SETTINGS
	private running = new Set<string>()

	async onload() {
		await this.loadSettings()

		this.addSettingTab(new EnzymeDigestSettingTab(this.app, this))

		// Register the code fence processor
		this.registerMarkdownCodeBlockProcessor(
			'enzyme-digest',
			this.processDigestBlock.bind(this)
		)

		// Command to insert a digest block
		this.addCommand({
			id: 'insert-enzyme-digest',
			name: 'Insert Enzyme Digest block',
			editorCallback: (editor) => {
				const prompt = this.settings.defaultPrompt
				const freq = this.settings.defaultFreq
				const block = `\`\`\`enzyme-digest\nprompt: ${prompt}\nfreq: ${freq}\n\`\`\`\n`
				editor.replaceSelection(block)
			},
		})

		// Command to refresh all digest blocks on the current page
		this.addCommand({
			id: 'refresh-enzyme-digests',
			name: 'Refresh all Enzyme Digest blocks on this page',
			callback: () => {
				// Clear cache to force refresh
				digestCache.clear()
				// Trigger a re-render by forcing the active leaf to refresh
				const leaf = this.app.workspace.getActiveViewOfType(
					(require('obsidian') as any).MarkdownView
				)
				if (leaf) {
					leaf.previewMode?.rerender(true)
					new Notice('Refreshing enzyme digests...')
				}
			},
		})
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

		// Auto-run for daily/weekly, or manual with stale cache
		await this.runDigest(config, el, ctx)
	}

	private getEffectiveSettings(): EnzymeDigestSettings {
		const s = { ...this.settings }
		// Default vault path to the current Obsidian vault's base path
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
