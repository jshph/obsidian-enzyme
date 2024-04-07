import { App, CachedMetadata, TFile } from 'obsidian'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { DataviewApi } from 'obsidian-dataview'
import { StrategyMetadata } from 'notebook/ReasonAgent'

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
		strategy?: StrategyMetadata
	): Promise<FileContents[]> {
		let contents = await this.app.vault.cachedRead(file)

		const replaced = await this.replaceEmbeds(contents, metadata)
		contents = replaced.contents
		let substitutions = replaced.substitutions

		contents = this.cleanContents(contents)

		let substituted = this.substituteBlockReferences(file.basename, contents)
		contents = substituted.contents

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
				contents,
				substitutions: [...substitutions, ...substituted.substitutions],
				tags
			}
		]
	}
}
