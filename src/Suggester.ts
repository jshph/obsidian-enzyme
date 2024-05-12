import dedent from 'dedent-js'
import {
	App,
	FuzzyMatch,
	FuzzySuggestModal,
	Instruction,
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
	}
}

export class Suggester extends FuzzySuggestModal<SuggesterSource> {
	selectedItems: SelectedItem[]
	setLimitModeEnabled: boolean = false
	nativeInputElPadding: string
	defaultLimit: number = 5
	constructor(
		app: App,
		private folders: string[]
	) {
		super(app)
		this.selectedItems = []

		this.scope.register(['Shift'], 'Enter', (evt: KeyboardEvent) => {
			this.resultContainerEl.setCssStyles({ display: 'block' })
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
			this.inputEl.value = ''
			const limitEl = this.inputEl.previousSibling as HTMLElement

			if (this.setLimitModeEnabled) {
				this.setLimitModeEnabled = false
				this.emptyStateText = this.defaultEmptyStateText
				this.resultContainerEl.setCssStyles({ display: 'block' })
				limitEl.removeClass('active')
				return
			}

			limitEl.addClass('active')

			this.setLimitModeEnabled = true
			this.emptyStateText = 'Type the limit for the selected evergreen'

			this.resultContainerEl.setCssStyles({ display: 'none' })
		})

		this.scope.register(['Mod'], 'Backspace', (evt: KeyboardEvent) => {
			if (this.setLimitModeEnabled) {
				this.setLimitModeEnabled = false
				this.emptyStateText = this.defaultEmptyStateText
				this.resultContainerEl.setCssStyles({ display: 'block' })
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
				command: 'shift ↵',
				purpose: 'Select this evergreen and go to find another'
			},
			{
				command: '↵',
				purpose: 'Insert Enzyme block'
			},
			{
				command: 'tab',
				purpose: 'Set the max number of files for the selected evergreen'
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

		this.resultContainerEl.setCssStyles({ display: 'block' })
		this.inputEl.setCssStyles({ paddingLeft: this.nativeInputElPadding })
		this.setLimitModeEnabled = false
	}

	defaultEmptyStateText: string = 'Type the name of a note or tag'

	produceEnzymeBlock() {
		const sourcesText = this.selectedItems.map((item) => {
			let dql: string
			switch (item.type) {
				case SourceType.Note:
					dql = `LIST WHERE contains(file.outlinks, ${item.entity}) SORT file.ctime DESC LIMIT ${item.limit}`
					break
				case SourceType.Tag:
					dql = `LIST WHERE contains(file.tags, "${item.entity}") SORT file.ctime DESC LIMIT ${item.limit}`
					break
				case SourceType.Folder:
					dql = `LIST FROM "${item.entity}" SORT file.mtime DESC LIMIT ${item.limit}`
					break
			}

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

		const tagCounts: Record<string, number> = {}

		// Compute counts for tags of recent files
		files.slice(0, 100).forEach((file) => {
			const tags = this.app.metadataCache
				.getFileCache(file)
				.tags?.map((tag) => tag.tag)
			if (tags) {
				tags.forEach((tag) => {
					if (tag) {
						tagCounts[tag] = (tagCounts[tag] || 0) + 1
					}
				})
			}
		})

		// Assign default value to remainder of tags
		files.slice(100).forEach((file) => {
			const tags = this.app.metadataCache
				.getFileCache(file)
				.tags?.map((tag) => tag.tag)
			if (tags) {
				tags.forEach((tag) => {
					if (tag) {
						tagCounts[tag] = tagCounts[tag] || 0
					}
				})
			}
		})

		const allFileTags: SuggesterSource[] = Object.entries(tagCounts)
			.sort((a, b) => b[1] - a[1]) // Sort by count in descending order
			.map((entry) => ({
				entity: entry[0],
				type: SourceType.Tag
			}))

		const activeLeafName = `[[${activeLeaf.basename}]]`
		const filteredFiles = allFiles.filter(
			(file) =>
				this.folders.length == 0 ||
				this.folders.some((folder) => file.path.contains(folder))
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
				el.setText('/' + item.item.entity)
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

	onChooseItem(item: SuggesterSource, evt: MouseEvent | KeyboardEvent): void {
		// Handle "limit setting mode"
		if (this.setLimitModeEnabled) {
			let limit
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
						strategy: 'LongContent'
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
