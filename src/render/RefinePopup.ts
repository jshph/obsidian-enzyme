import { Editor, EditorRange, editorEditorField } from 'obsidian'
import { createPopper } from '@popperjs/core'
import { EditorView, Decoration, DecorationSet } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'

export class RefinePopup {
	private refinePopupEl: HTMLElement
	private currentEditor: Editor | null = null
	private onSubmit: (prompt: string, format: string, cursorPos: EditorPosition) => void
	private anchorElement: HTMLElement | null = null
	private formatSelect: HTMLSelectElement
	private highlightDecoration: StateField<DecorationSet> | null = null
	private inputContainer: HTMLElement
	private input: HTMLInputElement

	constructor(
		onSubmit: (prompt: string, format: string, cursorPos: EditorPosition) => void
	) {
		this.onSubmit = onSubmit
		this.initPromptPopup()
	}

	private initPromptPopup() {
		this.refinePopupEl = document.body.createEl('div', {
			cls: 'enzyme-prompt-popup'
		})
		this.refinePopupEl.style.display = 'none'

		const popupContent = this.refinePopupEl.createEl('div', {
			cls: 'enzyme-prompt-popup-content'
		})

		const tooltipContainer = document.body.createEl('div', {
			cls: 'enzyme-prompt-tooltip-container'
		})
		tooltipContainer.style.display = 'none'

		const inputContainer = popupContent.createEl('div', {
			cls: 'enzyme-prompt-input-container'
		})

		this.formatSelect = inputContainer.createEl('select', {
			cls: 'enzyme-prompt-format-select'
		})
		const formats = [
			{ value: '🔎 Focus', tooltip: 'Refine and expand on the selected content' },
			{ value: '🪶 Style', tooltip: 'Rewrite the selected content with a style that matches the prompt' }
		]
		formats.forEach((format) => {
			const option = this.formatSelect.createEl('option', { text: format.value, value: format.value })
		})

		this.formatSelect.addEventListener('mouseover', (e) => {
			const selectedFormat = (e.target as HTMLSelectElement).value
			const selectedTooltip = formats.find(f => f.value === selectedFormat)?.tooltip
			tooltipContainer.textContent = selectedTooltip || ''
			tooltipContainer.style.display = 'block'
			const rect = this.formatSelect.getBoundingClientRect()
			tooltipContainer.style.top = `${rect.top - tooltipContainer.offsetHeight - 10}px`
			tooltipContainer.style.left = `${rect.left}px`
		})

		this.formatSelect.addEventListener('mouseout', () => {
			tooltipContainer.style.display = 'none'
		})

		this.inputContainer = inputContainer
		this.input = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Refine'
		})

		// Add focus and blur event listeners
		this.input.addEventListener('focus', this.expandInput.bind(this))
		this.input.addEventListener('blur', this.collapseInput.bind(this))

		const sendButton = inputContainer.createEl('button', {
			cls: 'enzyme-prompt-send-button',
			text: '→'
		})

		// Handle input events
		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.handlePromptSubmit(this.input.value)
			} else if (e.key === 'Escape') {
				this.hide()
			}
		})

		sendButton.addEventListener('click', () => {
			this.handlePromptSubmit(this.input.value)
		})

		// Handle click outside of the popup
		document.addEventListener('click', (e) => {
			if (
				!this.refinePopupEl.contains(e.target as Node) &&
				this.refinePopupEl.style.display !== 'none'
			) {
				this.hide()
			}
		})

		// Prevent clicks inside the popup from closing it
		this.refinePopupEl.addEventListener('click', (e) => {
			e.stopPropagation()
		})
	}

	show(editor: Editor) {
		this.currentEditor = editor
		this.refinePopupEl.style.display = 'block'
		const cursorPos = editor.getCursor()
		const cursorCoords = editor.cm.coordsAtPos(editor.posToOffset(cursorPos))

		this.anchorElement = document.createElement('div')
		this.anchorElement.style.position = 'absolute'
		this.anchorElement.style.left = `${cursorCoords.left}px`
		this.anchorElement.style.top = `${cursorCoords.top}px`
		document.body.appendChild(this.anchorElement)

		createPopper(this.anchorElement, this.refinePopupEl, {
			placement: 'top-start',
			modifiers: [
				{
					name: 'offset',
					options: {
						offset: [0, 10]
					}
				}
			]
		})

		// Remove this line to prevent auto-focus
		// this.refinePopupEl.querySelector('input')?.focus()

		// Add temporary highlight
		// this.addTemporaryHighlight()
	}

	hide() {
		this.refinePopupEl.style.display = 'none'
		this.anchorElement?.remove()
		this.anchorElement = null
		;(this.refinePopupEl.querySelector('input') as HTMLInputElement).value = ''

		// Remove temporary highlight
		// this.removeTemporaryHighlight()

		this.currentEditor = null
	}

	private handlePromptSubmit(prompt: string) {
		if (this.currentEditor) {
			const format = this.formatSelect.value
			const cursorPos = this.currentEditor.getCursor()

			this.onSubmit(prompt, format, cursorPos)
			this.hide()
			this.collapseInput() // Collapse the input after submission
		}
	}

	private addTemporaryHighlight() {
		const view = this.currentEditor?.cm as EditorView
		const selection = this.currentEditor?.getSelection()
		const from = this.currentEditor?.posToOffset(
			this.currentEditor.getCursor('from')
		)
		const to = this.currentEditor?.posToOffset(this.currentEditor.getCursor('to'))

		const highlightEffect = StateEffect.define<EditorRange[]>()

		this.highlightDecoration = StateField.define<DecorationSet>({
			create() {
				return Decoration.none
			},
			update(highlights, tr) {
				highlights = highlights.map(tr.changes)
				for (let e of tr.effects) {
					if (e.is(highlightEffect)) {
						highlights = Decoration.set(
							e.value.map((range) =>
								Decoration.mark({ class: 'cm-temporary-highlight' }).range(
									range.from,
									range.to
								)
							)
						)
					}
				}
				return highlights
			},
			provide: (f) => EditorView.decorations.from(f)
		})

		view.dispatch({
			effects: [
				highlightEffect.of([{ from, to }]),
				StateEffect.appendConfig.of([this.highlightDecoration])
			]
		})
	}

	private removeTemporaryHighlight() {
		if (this.currentEditor && this.highlightDecoration) {
			editorEditorField.dispatch({
				effects: StateEffect.reconfigure.of(
					view.state
						.facet(EditorView.decorations)
						.filter((d) => d !== this.highlightDecoration)
				)
			})
			this.highlightDecoration = null
		}
	}

	private expandInput() {
		this.inputContainer.classList.add('expanded')
		this.input.placeholder = 'Enter your refinement prompt...'
	}

	private collapseInput() {
		if (!this.input.value) {
			this.inputContainer.classList.remove('expanded')
			this.input.placeholder = 'Refine'
		}
	}
}
