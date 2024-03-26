import { App, CachedMetadata, TFile } from 'obsidian'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { DataviewApi } from 'obsidian-dataview'

export class BasicExtractor extends BaseExtractor {
	constructor(
		public app: App,
		public dataviewAPI: DataviewApi
	) {
		super()
	}

	async extract(
		file?: TFile,
		metadata?: CachedMetadata,
		strategy?: string,
		evergreen?: string
	): Promise<FileContents[]> {
		let rawContents = await this.app.vault.cachedRead(file)
		const {
			contents: embedReplacedContents,
			substitutions: embedSubstitutions
		} = await this.replaceEmbeds(rawContents, metadata)

		let cleanContents = this.cleanContents(embedReplacedContents)

		let { substitutions, contents } = this.substituteBlockReferences(
			file.basename,
			cleanContents
		)

		const tags = []
		if (
			Array.isArray(metadata?.frontmatter?.tags) &&
			metadata.frontmatter.tags.length > 0
		) {
			tags.push(...metadata.frontmatter.tags.map((tag) => `#${tag}`))
		}

		return [
			{
				file: file.basename,
				last_modified_date: new Date(file.stat.mtime).toLocaleDateString(),
				contents: contents,
				substitutions: [...substitutions, ...embedSubstitutions],
				tags: tags
			}
		]
	}
}
