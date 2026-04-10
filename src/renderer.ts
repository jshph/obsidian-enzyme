import { App } from 'obsidian'
import type { DigestOutput, DigestStep } from './llm'

/**
 * Render a digest into the given container element.
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

	// Separator
	container.createEl('div', { cls: 'enzyme-digest-separator', text: '. . . . .' })

	// Steps
	digest.steps.forEach((step, i) => {
		const stepEl = container.createEl('div', { cls: 'enzyme-digest-step' })

		// Source header — clickable to open the note
		const sourceHeader = stepEl.createEl('div', { cls: 'enzyme-digest-source' })
		const sourceLink = sourceHeader.createEl('a', {
			cls: 'enzyme-digest-source-link',
			text: `${step.author} — ${step.title}`,
		})
		sourceLink.addEventListener('click', (e) => {
			e.preventDefault()
			openSourceNote(app, step.source_file)
		})

		// Excerpt as blockquote — clickable to open source
		const blockquote = stepEl.createEl('blockquote', { cls: 'enzyme-digest-excerpt' })
		blockquote.createEl('p', { text: step.excerpt })
		blockquote.addEventListener('click', () => {
			openSourceNote(app, step.source_file)
		})

		// Probe — the push to continue writing
		const probe = stepEl.createEl('div', { cls: 'enzyme-digest-probe' })
		probe.createEl('span', { text: step.probe })

		// Separator between steps
		if (i < digest.steps.length - 1) {
			container.createEl('div', { cls: 'enzyme-digest-step-separator' })
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
