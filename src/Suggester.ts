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
	constructor(
		app: App,
		private evergreenFolders: string[],
		private longContentFolders: string[]
	) {
		super(app)
		this.selectedItems = []

		// Setup result and preview container to be toggled between
		this.dqlResultEl = createDiv({ cls: 'dql-results' })
		this.resultContainerEl.parentElement.insertBefore(
			this.dqlResultEl,
			this.resultContainerEl
		)

		this.scope.register(['Shift'], 'Enter', (evt: KeyboardEvent) => {
			// User has selected an item so we can remove the preview
			this.hideDQLResult()

			// Let user select the next one from resultContainer
			const selectItemResult = this.chooser.useSelectedItem(evt)
			if (!selectItemResult) {
				// Handle special case in limit mode, where number doesn't select a valid item
				if (this.setLimitModeEnabled) {
					this.onChooseItem(undefined, evt)
				}
			}
			this.inputEl.value = ''
		})

		this.scope.register([], 'Tab', (evt: KeyboardEvent) => {
			// Insert a pill to denote mode switch to typing in a tab
			evt.preventDefault()

			const limitEl = this.inputEl.previousSibling as HTMLElement
			this.inputEl.addClass('limit-mode')

			if (this.setLimitModeEnabled) {
				// If in this mode, allow the user to use Tab rather than just Shift+Enter to set the limit
				this.setLimitForCurrentItem()
				this.setLimitModeEnabled = false

				this.emptyStateText = this.defaultEmptyStateText
				limitEl.removeClass('active')

				// Disable the limit mode removes the preview
				this.hideDQLResult()
				this.inputEl.value = ''

				this.updateSuggestions()
				return
			}

			limitEl.addClass('active')

			this.inputEl.value = ''
			this.setLimitModeEnabled = true

			this.renderDQLPreview()
			this.showDQLResult()
		})

		this.scope.register(['Mod'], 'Backspace', (evt: KeyboardEvent) => {
			if (this.setLimitModeEnabled) {
				this.setLimitModeEnabled = false
				this.emptyStateText = this.defaultEmptyStateText

				// User has decided to cancel the limit setting operation
				this.hideDQLResult()
			} else {
				this.selectedItems.pop()
			}
			if (this.inputEl.previousSibling) {
				const limitEl = this.inputEl.previousSibling
				const itemEl = this.inputEl.previousSibling.previousSibling
				this.inputEl.parentElement.removeChild(limitEl)
				this.inputEl.parentElement.removeChild(itemEl)

				if (!this.inputEl.previousSibling) {
					this.inputEl.setCssStyles({ paddingLeft: this.nativeInputElPadding })
				}
			}
		})

		const modalInstructions: Instruction[] = [
			{
				command: 'tab',
				purpose: 'Set the max number of files for the selection'
			},
			{
				command: 'shift ↵',
				purpose: 'Select and go to find another'
			},
			{
				command: '↵',
				purpose: 'Insert Enzyme block'
			}
		]

		this.setInstructions(modalInstructions)
	}

	onOpen(): void {
		// Want to be free to call close() without losing selectedItems
		this.selectedItems = []
		this.emptyStateText = this.defaultEmptyStateText
	}

	onClose(): void {
		this.inputEl.value = ''
		while (this.inputEl.previousSibling) {
			this.inputEl.parentElement.removeChild(this.inputEl.previousSibling)
		}

		this.inputEl.setCssStyles({ paddingLeft: this.nativeInputElPadding })
		this.setLimitModeEnabled = false
	}

	hideDQLResult() {
		this.dqlResultEl.removeClass('active')
		setTimeout(() => {
			this.dqlResultEl.empty()
			this.resultContainerEl.setCssStyles({ display: 'block' })
		}, 700)
	}

	showDQLResult() {
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

		const concatenatedItems = this.selectedItems
			.map((item) => item.entity.replace('#', ''))
			.join(' and ')

		return dedent`
      \`\`\`enzyme
      sources:
      ${sourcesText.join('\n')}
      guidance: Relate the recent mentions of ${concatenatedItems} together
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
		this.inputEl.removeClass('limit-mode')

		if (this.inputEl.value == '') {
			new Notice('Empty limit value')
			return
		}

		try {
			limit = parseInt(this.inputEl.value)
		} catch (e) {
			new Notice(`Invalid limit value: ${this.inputEl.value}`)
		}

		const limitEl = this.inputEl.previousSibling as HTMLElement
		limitEl.textContent = `limit: ${limit}`
		limitEl.removeClass('active')

		// If in limit setting mode, a pill button was already inserted, so we just update the limit
		this.selectedItems[this.selectedItems.length - 1].limit = limit
		this.inputEl.removeClass('limit-mode')

		this.renderDQLPreview()
	}

	renderDQLPreview() {
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
			this.nativeInputElPadding =
				this.inputEl.getCssPropertyValue('paddingLeft')
			this.inputEl.setCssStyles({ paddingLeft: '5px' }) // If adding a pill, reduce the padding before the pill

			this.insertPillForItem(item)

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

		if (!evt.shiftKey) {
			this.close()
			this.app.workspace.activeEditor.editor.replaceSelection(
				this.produceEnzymeBlock()
			)
		}
	}
}
