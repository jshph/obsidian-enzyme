import { App } from 'obsidian'
import type { DigestOutput } from './llm'
import { getVaultBasePath, toRelativeVaultPath } from './main'

export function renderDigest(
	digest: DigestOutput,
	container: HTMLElement,
	app: App,
	sourcePath: string
) {
	container.empty()
	container.addClass('enzyme-digest-container')

	// Intro — left aligned
	const intro = container.createEl('div', { cls: 'enzyme-digest-intro' })
	intro.createEl('p', { text: digest.intro })

	// Steps
	digest.steps.forEach((step, i) => {
		const stepEl = container.createEl('div', {
			cls: `enzyme-digest-step ${step.is_external ? 'enzyme-digest-step--external' : ''}`,
		})

		// Date + note name on one line
		const header = stepEl.createEl('div', { cls: 'enzyme-digest-header' })

		if (step.date) {
			header.createEl('span', {
				cls: 'enzyme-digest-date',
				text: formatDate(step.date),
			})
		}

		const noteLink = header.createEl('a', {
			cls: 'enzyme-digest-note-link',
			text: step.note_name,
		})
		noteLink.addEventListener('click', (e) => {
			e.preventDefault()
			openSourceNote(app, step.source_file)
		})

		if (step.is_external && step.attribution) {
			header.createEl('span', {
				cls: 'enzyme-digest-attribution',
				text: `— ${step.attribution}`,
			})
		}

		if (step.is_external) {
			header.createEl('span', {
				cls: 'enzyme-digest-badge',
				text: 'highlight',
			})
		}

		// Excerpt
		const blockquote = stepEl.createEl('blockquote', { cls: 'enzyme-digest-excerpt' })
		blockquote.createEl('p', { text: step.excerpt })
		blockquote.addEventListener('click', () => {
			openSourceNote(app, step.source_file)
		})

		// Probe
		stepEl.createEl('div', { cls: 'enzyme-digest-probe' }).createEl('span', { text: step.probe })

		// Divider between steps
		if (i < digest.steps.length - 1) {
			container.createEl('hr', { cls: 'enzyme-digest-divider' })
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

export function renderLoading(container: HTMLElement, message: string) {
	container.empty()
	container.addClass('enzyme-digest-container')
	const loading = container.createEl('div', { cls: 'enzyme-digest-loading' })
	loading.createEl('div', { cls: 'enzyme-digest-spinner' })
	loading.createEl('p', { text: message })
}

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
	const relativePath = toRelativeVaultPath(filePath, getVaultBasePath(app))
	const linkText = relativePath.replace(/\.md$/, '')
	app.workspace.openLinkText(linkText, '', false)
}
