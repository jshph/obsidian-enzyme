import dedent from 'dedent-js'
import {
	App,
	Component,
	FuzzyMatch,
	FuzzySuggestModal,
	Instruction,
	MarkdownRenderer,
	MarkdownView,
	Notice
} from 'obsidian'

type SelectedItem = {
	entity: string
	type: SourceType
	limit: number
	strategy: Strategy
}

enum SourceType {
	Note,
	Tag,
	Folder
}

type SuggesterSource = {
	entity: string
	type: SourceType
}

type Strategy = {
	strategy: string
	evergreen?: string
}

// internal
declare module 'obsidian' {
	interface FuzzySuggestModal<T> {
		chooser?: {
			useSelectedItem: (evt: KeyboardEvent) => boolean
			selectedItem: number
			suggestions: HTMLElement[]
		}
		updateSuggestions: () => void
	}
}

export class Suggester extends FuzzySuggestModal<SuggesterSource> {
	selectedItems: SelectedItem[]
	setLimitModeEnabled: boolean = false
	nativeInputElPadding: string
	defaultLimit: number = 5
	dqlResultEl: HTMLElement
	selectModeEnabled: boolean = false
	divInputEl: HTMLElement
	atSpanContents: string = ''
	constructor(
		app: App,
		private evergreenFolders: string[],
		private longContentFolders: string[]
	) {
		super(app)

		this.divInputEl = document.createElement('div')
		this.divInputEl.addClasses(['prompt-input', 'editablediv'])
		this.divInputEl.contentEditable = 'true'
		this.inputEl.parentElement.insertBefore(this.divInputEl, this.inputEl)

		// keep it around as a container for parent to use its value to search suggestions
		this.inputEl.setCssStyles({ display: 'none' })

		this.selectedItems = []
		this.dqlResultEl = this.createDQLResultElement()
		this.setupEventHandlers()
		this.setInstructions(this.getModalInstructions())
	}

	private createDQLResultElement(): HTMLElement {
		const dqlResultEl = createDiv({ cls: 'dql-results' })
		this.resultContainerEl.parentElement.insertBefore(
			dqlResultEl,
			this.resultContainerEl
		)
		return dqlResultEl
	}

	private setupEventHandlers(): void {
		this.scope.register(['Shift'], 'Enter', this.handleShiftEnter.bind(this))

		// This took forever to find
		this.scope.unregister(this.scope.keys.find((key) => key.key === 'Enter'))
		this.scope.register([], 'Enter', (evt) => {
			evt.preventDefault()
			this.handleEnter(evt)
		})

		this.divInputEl.addEventListener('beforeinput', this.handleInput.bind(this))
	}

	private handleShiftEnter(evt: KeyboardEvent): void {
		this.selectModeEnabled = false

		this.hideDQLResult()
		const selectItemResult = this.chooser.useSelectedItem(evt)
		if (!selectItemResult && this.setLimitModeEnabled) {
			this.onChooseItem(undefined, evt)
		}
		this.inputEl.value = ''
	}

	private handleEnter(evt: KeyboardEvent): void {
		evt.preventDefault()

		// Break out of the span from below
		const inputEl = this.divInputEl
		const lastNode = inputEl.lastChild

		this.chooser.useSelectedItem(evt)

		if (lastNode.nodeType === Node.ELEMENT_NODE) {
			lastNode.textContent =
				this.selectedItems[this.selectedItems.length - 1].entity
			lastNode.addClass('active')
		} else {
			this.close()
			this.app.workspace.activeEditor.editor.replaceSelection(
				this.produceEnzymeBlock()
			)
		}
	}

	private handleInput(evt: InputEvent): void {
		evt.preventDefault()
		const inputEl = this.divInputEl

		if (evt.inputType === 'insertText' && evt.data === '@') {
			// Create a new span element when '@' is typed
			const span = document.createElement('span')
			span.textContent = '@'
			span.addClass('input-pill')

			// Append the span to the div
			inputEl.appendChild(span)

			// Move the cursor to the end of the contentEditable div
			const range = document.createRange()
			const sel = window.getSelection()
			range.setStartAfter(span)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		} else if (evt.inputType === 'insertText') {
			// Append the newly typed character to the last text node or create a new text node
			let lastNode = inputEl.lastChild
			if (!lastNode) {
				lastNode = document.createTextNode(evt.data)
				inputEl.appendChild(lastNode)
			} else {
				lastNode.textContent += evt.data
			}

			if (lastNode.nodeType === Node.ELEMENT_NODE) {
				this.inputEl.value = lastNode.textContent.slice(1)
				this.updateSuggestions()
			}

			// Handle edge case for space insertion
			if (evt.data === ' ') {
				const spaceNode = document.createTextNode(' ')
				inputEl.appendChild(spaceNode)
			}

			// Move the cursor to the end of the contentEditable div
			const range = document.createRange()
			const sel = window.getSelection()
			range.selectNodeContents(inputEl)
			range.collapse(false)
			sel.removeAllRanges()
			sel.addRange(range)
		} else if (evt.inputType === 'deleteContentBackward') {
			// Handle Backspace key by deleting the last character
			const lastNode = inputEl.lastChild
			if (lastNode.nodeType === Node.TEXT_NODE) {
				lastNode.textContent = lastNode.textContent.slice(0, -1)
				if (lastNode.textContent === '') {
					inputEl.removeChild(lastNode)
				}
			} else if (lastNode.nodeType === Node.ELEMENT_NODE) {
				inputEl.removeChild(lastNode)
				this.selectedItems.remove(
					this.selectedItems.find(
						(item) => item.entity == lastNode.textContent.trim()
					)
				)

				// Clear suggestions when we've just removed the last tag
				this.inputEl.value = ''
				this.updateSuggestions()
			}
		}
	}

	// private handleModBackspace(evt: KeyboardEvent): void {
	// 	if (this.setLimitModeEnabled) {
	// 		this.disableLimitMode()
	// 	} else {
	// 		this.removeLastSelectedItem()
	// 	}
	// }

	// private enableLimitMode(limitEl: HTMLElement): void {
	// 	limitEl.addClass('active')
	// 	this.inputEl.value = ''
	// 	this.setLimitModeEnabled = true
	// 	this.renderDQLPreview()
	// 	this.showDQLResult()
	// }

	// private disableLimitMode(): void {
	// 	this.setLimitModeEnabled = false
	// 	this.inputEl.removeClass('limit-mode')
	// 	this.emptyStateText = this.defaultEmptyStateText
	// 	this.hideDQLResult()
	// 	this.inputEl.value = ''
	// 	this.updateSuggestions()

	// 	const limitEl = this.inputEl.previousSibling as HTMLElement
	// 	if (limitEl) {
	// 		limitEl.removeClass('active')
	// 	}
	// }

	private removeLastSelectedItem(): void {
		this.selectedItems.pop()
		if (this.inputEl.previousSibling) {
			const limitEl = this.inputEl.previousSibling
			const itemEl = this.inputEl.previousSibling.previousSibling
			this.inputEl.parentElement.removeChild(limitEl)
			this.inputEl.parentElement.removeChild(itemEl)
			if (!this.inputEl.previousSibling) {
				this.inputEl.setCssStyles({ paddingLeft: this.nativeInputElPadding })
			}
		}
	}

	private getModalInstructions(): Instruction[] {
		return [
			{
				command: 'tab',
				purpose: 'Set the max number of files for the selection'
			},
			{ command: 'shift ↵', purpose: 'Select and go to find another' },
			{ command: '↵', purpose: 'Insert Enzyme block' }
		]
	}

	onOpen(): void {
		this.divInputEl.textContent = ''
		this.selectedItems = []
		// this.emptyStateText = this.defaultEmptyStateText
	}

	onClose(): void {
		// this.inputEl.value = ''
		// this.hideDQLResult()
		// while (this.inputEl.previousSibling) {
		// 	this.inputEl.parentElement.removeChild(this.inputEl.previousSibling)
		// }
		// this.inputEl.setCssStyles({ paddingLeft: this.nativeInputElPadding })
		// this.setLimitModeEnabled = false
	}

	hideDQLResult(): void {
		this.dqlResultEl.removeClass('active')
		setTimeout(() => {
			this.dqlResultEl.empty()
			this.resultContainerEl.setCssStyles({ display: 'block' })
		}, 700)
	}

	showDQLResult(): void {
		this.dqlResultEl.addClass('active')
		setTimeout(() => {
			this.resultContainerEl.setCssStyles({ display: 'none' })
		}, 200)
	}

	defaultEmptyStateText: string = 'Type the name of a note or tag'

	buildDQL(item: SelectedItem): string {
		switch (item.type) {
			case SourceType.Note:
				return `LIST WHERE contains(file.outlinks, ${item.entity}) SORT file.ctime DESC LIMIT ${item.limit}`
			case SourceType.Tag:
				return `LIST WHERE contains(file.tags, "${item.entity}") SORT file.ctime DESC LIMIT ${item.limit}`
			case SourceType.Folder:
				let sortOrder = 'file.ctime'
				if (item.strategy.strategy === 'LongContent') {
					sortOrder = 'file.mtime'
				}
				return `LIST FROM "${item.entity}" SORT ${sortOrder} DESC LIMIT ${item.limit}`
		}
	}

	produceEnzymeBlock() {
		const sourcesText = this.selectedItems.map((item) => {
			let dql: string = this.buildDQL(item)

			return dedent`
        - strategy: ${item.strategy.strategy}
          dql: ${dql}${item.strategy.evergreen ? `\n  evergreen: "${item.strategy.evergreen}"` : ''}
      `
		})

		// TODO as default
		// Relate the recent mentions of ${concatenatedItems} together

		return dedent`
      \`\`\`enzyme
      sources:
      ${sourcesText.join('\n')}
      guidance: "${this.divInputEl.innerText}"
      \`\`\`
    `
	}

	getItems(): SuggesterSource[] {
		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView).file
		const allFiles = this.app.vault.getMarkdownFiles()
		const allFolders = this.app.vault
			.getMarkdownFiles()
			.sort((a, b) => b.stat.ctime - a.stat.ctime) // Most recent first
			.map((file) => file.parent.path)
			.filter((path) => path != '')
			.unique()

		const files = allFiles.sort((a, b) => b.stat.ctime - a.stat.ctime)

		// Get tags of recently created files
		const allFileTags: SuggesterSource[] = files
			.flatMap((file) =>
				this.app.metadataCache.getFileCache(file).tags?.map((tag) => tag.tag)
			)
			.filter((tag) => tag && tag != '')
			.unique()
			.map((tag) => ({ entity: tag, type: SourceType.Tag }))

		const activeLeafName = `[[${activeLeaf.basename}]]`
		const filteredFiles = allFiles.filter(
			(file) =>
				this.evergreenFolders.length == 0 ||
				this.evergreenFolders.some((folder) => file.path.contains(folder))
		)
		const renderedFiles: SuggesterSource[] = filteredFiles.map((file) => ({
			entity: `[[${file.basename}]]`,
			type: SourceType.Note
		}))

		const renderedFolders: SuggesterSource[] = allFolders.map((folder) => ({
			entity: folder,
			type: SourceType.Folder
		}))

		// helpful ordering to visually improve recall
		return [
			{ entity: activeLeafName, type: SourceType.Note },
			...allFileTags.slice(0, 15),
			...renderedFolders.slice(0, 10),
			...renderedFiles,
			...allFileTags.slice(15),
			...renderedFolders.slice(10)
		]
	}

	renderSuggestion(item: FuzzyMatch<SuggesterSource>, el: HTMLElement): void {
		el.setText(item.item.entity)
		switch (item.item.type) {
			case SourceType.Note:
				el.addClass('suggestion-note')
				break
			case SourceType.Tag:
				el.addClass('suggestion-tag')
				break
			case SourceType.Folder:
				el.addClass('suggestion-folder')
				el.setText('folder: ' + item.item.entity)
				break
		}
	}

	getItemText(item: SuggesterSource): string {
		return item.entity
	}

	// internally, called by useSelectedItem with the value
	selectSuggestion(
		value: FuzzyMatch<SuggesterSource>,
		evt: KeyboardEvent | MouseEvent
	): void {
		// Need to override this because we don't want to close the modal as per default
		// @ts-ignore
		this.app.keymap.updateModifiers(evt)
		this.onChooseItem(value.item, evt)
	}

	insertPillForItem(item: SuggesterSource) {
		const pill = createDiv({ text: item.entity, cls: 'pill' })
		this.inputEl.parentElement.insertBefore(pill, this.inputEl)

		const limitPill = createDiv({
			text: `limit: ${this.defaultLimit}`,
			cls: ['pill', 'limit']
		})

		this.inputEl.parentElement.insertBefore(limitPill, this.inputEl)
	}

	setLimitForCurrentItem() {
		let limit

		if (this.inputEl.value == '') {
			new Notice('Empty limit value')
			return
		}

		try {
			limit = parseInt(this.inputEl.value)
		} catch (e) {
			new Notice(`Invalid limit value: ${this.inputEl.value}`)
			this.disableLimitMode()
			return
		}

		const limitEl = this.inputEl.previousSibling as HTMLElement
		limitEl.textContent = `limit: ${limit}`
		limitEl.removeClass('active')

		// If in limit setting mode, a pill button was already inserted, so we just update the limit
		this.selectedItems[this.selectedItems.length - 1].limit = limit

		this.renderDQLPreview()
	}

	renderDQLPreview() {
		if (this.selectedItems.length == 0) {
			return
		}

		// Render the DQL preview in the DQL result container
		let dqlResultPreview = dedent`
    ### Preview:
    \`\`\`dataview
    ${this.buildDQL(this.selectedItems[this.selectedItems.length - 1])}
    \`\`\`
    `.trim()

		this.dqlResultEl.empty()
		MarkdownRenderer.render(
			this.app,
			dqlResultPreview,
			this.dqlResultEl,
			'/',
			new Component()
		)
	}

	onChooseItem(item: SuggesterSource, evt: MouseEvent | KeyboardEvent): void {
		// Handle "limit setting mode"
		if (this.setLimitModeEnabled) {
			this.setLimitForCurrentItem()
			this.setLimitModeEnabled = false
		}

		// If the user has already selected items, assume that empty typed input means they have decided
		// they don't want to select any more

		// Handle "select items mode"
		else if (
			evt.shiftKey ||
			!(this.selectedItems.length > 0 && this.inputEl.value == '')
		) {
			// this.nativeInputElPadding =
			// 	this.inputEl.getCssPropertyValue('paddingLeft')
			// this.inputEl.setCssStyles({ paddingLeft: '5px' }) // If adding a pill, reduce the padding before the pill

			// this.insertPillForItem(item)

			let strategy: Strategy
			switch (item.type) {
				case SourceType.Note:
					strategy = {
						strategy: 'SingleEvergreenReferrer',
						evergreen: item.entity
					}
					break
				case SourceType.Tag:
					strategy = {
						strategy: 'SingleEvergreenReferrer',
						evergreen: item.entity
					}
					break
				case SourceType.Folder:
					strategy = {
						strategy: this.longContentFolders.includes(item.entity)
							? 'LongContent'
							: 'Basic'
					}
					break
			}

			// Insert the selected item into the selectedItems
			this.selectedItems.push({
				entity: item.entity,
				type: item.type,
				limit: this.defaultLimit,
				strategy
			})
		}
	}
}
