import dedent from 'dedent-js'
import { App, FuzzySuggestModal, MarkdownView } from 'obsidian'

export class Suggester extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private folders: string[]
	) {
		super(app)
	}
	emptyStateText: string = 'Type the name of a note or tag'

	getItems(): string[] {
		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView).file
		const allFiles = this.app.vault.getFiles()
		const files = allFiles.sort((a, b) => b.stat.ctime - a.stat.ctime)

		const tagCounts: Record<string, number> = {}
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
		const allFileTags: string[] = Object.entries(tagCounts)
			.sort((a, b) => b[1] - a[1]) // Sort by count in descending order
			.map((entry) => entry[0]) // Extract the tag names

		const activeLeafName = `[[${activeLeaf.basename}]]`
		const filteredFiles = allFiles.filter(
			(file) =>
				this.folders.length == 0 ||
				this.folders.some((folder) => file.path.contains(folder))
		)
		const renderedFiles = filteredFiles.map((file) => `[[${file.basename}]]`)

		// helpful ordering to visually improve recall
		return [
			activeLeafName,
			...allFileTags.slice(0, 15),
			...renderedFiles,
			...allFileTags.slice(15)
		]
	}
	getItemText(item: string): string {
		return item
	}
	items: string[] = []
	onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
		let filter: string
		if (item.contains('[[')) {
			filter = `contains(file.outlinks, ${item})`
		} else if (item.contains('#')) {
			filter = `contains(file.tags, "${item}")`
		}

		this.app.workspace.activeEditor.editor.replaceSelection(dedent`
    \`\`\`enzyme
    sources:
      - strategy: SingleEvergreenReferrer
        dql: LIST WHERE ${filter} SORT file.ctime DESC LIMIT 15
        evergreen: "${item}"
    guidance: Relate the recent mentions of ${item.replace('#', '')} together
    \`\`\`
    `)
	}
}
