import { App } from 'obsidian'
import type { DigestOutput, DigestStep } from './llm'

/**
 * Render a digest as a timeline of connected notes.
 * Excerpts are clickable — they open the source note in Obsidian.
 */
export function renderDigest(
	digest: DigestOutput,
	container: HTMLElement,
	app: App,
	sourcePath: string
) {
	container.empty()
	container.addClass('enzyme-digest-container')

	// Intro
	const intro = container.createEl('div', { cls: 'enzyme-digest-intro' })
	intro.createEl('p', { text: digest.intro })

	// Timeline
	const timeline = container.createEl('div', { cls: 'enzyme-digest-timeline' })

	digest.steps.forEach((step, i) => {
		const stepEl = timeline.createEl('div', {
			cls: `enzyme-digest-step ${step.is_external ? 'enzyme-digest-step--external' : 'enzyme-digest-step--own'}`,
		})

		// Timeline node
		const node = stepEl.createEl('div', { cls: 'enzyme-digest-node' })

		// Date badge (if available)
		if (step.date) {
			node.createEl('span', {
				cls: 'enzyme-digest-date',
				text: formatDate(step.date),
			})
		}

		// Content column
		const content = stepEl.createEl('div', { cls: 'enzyme-digest-content' })

		// Header: note name — clickable
		const header = content.createEl('div', { cls: 'enzyme-digest-header' })
		const noteLink = header.createEl('a', {
			cls: 'enzyme-digest-note-link',
			text: step.note_name,
		})
		noteLink.addEventListener('click', (e) => {
			e.preventDefault()
			openSourceNote(app, step.source_file)
		})

		// Attribution for external sources
		if (step.is_external && step.attribution) {
			header.createEl('span', {
				cls: 'enzyme-digest-attribution',
				text: ` — ${step.attribution}`,
			})
		}

		// Source badge
		if (step.is_external) {
			header.createEl('span', {
				cls: 'enzyme-digest-badge',
				text: 'highlight',
			})
		}

		// Excerpt as blockquote — clickable
		const blockquote = content.createEl('blockquote', { cls: 'enzyme-digest-excerpt' })
		blockquote.createEl('p', { text: step.excerpt })
		blockquote.addEventListener('click', () => {
			openSourceNote(app, step.source_file)
		})

		// Probe
		const probe = content.createEl('div', { cls: 'enzyme-digest-probe' })
		probe.createEl('span', { text: step.probe })

		// Connection line to next step
		if (i < digest.steps.length - 1) {
			timeline.createEl('div', { cls: 'enzyme-digest-connector' })
		}
	})

	// Footer
	const footer = container.createEl('div', { cls: 'enzyme-digest-footer' })
	const now = new Date()
	footer.createEl('span', {
		text: `surfaced ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
	})
	footer.createEl('span', { text: ' · enzyme digest', cls: 'enzyme-digest-brand' })
}

function formatDate(dateStr: string): string {
	// Input: YYYY-MM-DD → output: "Mar 15" or "Mar 15, 2024"
	const parts = dateStr.split('-')
	if (parts.length < 3) return dateStr
	const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
	const now = new Date()
	const sameYear = date.getFullYear() === now.getFullYear()
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
	})
}

/**
 * Render a loading state.
 */
export function renderLoading(container: HTMLElement, message: string) {
	container.empty()
	container.addClass('enzyme-digest-container')
	const loading = container.createEl('div', { cls: 'enzyme-digest-loading' })
	loading.createEl('div', { cls: 'enzyme-digest-spinner' })
	loading.createEl('p', { text: message })
}

/**
 * Render an error state.
 */
export function renderError(container: HTMLElement, error: string) {
	container.empty()
	container.addClass('enzyme-digest-container')
	const errEl = container.createEl('div', { cls: 'enzyme-digest-error' })
	errEl.createEl('p', { text: `digest failed: ${error}` })
	errEl.createEl('p', {
		text: 'Check your Enzyme Digest settings (API key, model, vault path).',
		cls: 'enzyme-digest-error-hint',
	})
}

/**
 * Render the idle state with a run button.
 */
export function renderIdle(
	container: HTMLElement,
	prompt: string,
	freq: string,
	onRun: () => void
) {
	container.empty()
	container.addClass('enzyme-digest-container')

	const idle = container.createEl('div', { cls: 'enzyme-digest-idle' })
	idle.createEl('p', { text: `prompt: "${prompt}"`, cls: 'enzyme-digest-prompt-preview' })
	idle.createEl('p', { text: `refresh: ${freq}`, cls: 'enzyme-digest-freq-preview' })

	const btn = idle.createEl('button', {
		text: 'generate digest',
		cls: 'enzyme-digest-run-btn',
	})
	btn.addEventListener('click', onRun)
}

function openSourceNote(app: App, filePath: string) {
	let relativePath = filePath

	const vaultRoot = (app.vault.adapter as any).basePath
	if (vaultRoot && relativePath.startsWith(vaultRoot)) {
		relativePath = relativePath.slice(vaultRoot.length).replace(/^\//, '')
	}

	const linkText = relativePath.replace(/\.md$/, '')
	app.workspace.openLinkText(linkText, '', false)
}
