import { App, CachedMetadata, TFile } from 'obsidian'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { DataviewApi } from 'obsidian-dataview'
import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'
import { DQLStrategy } from './Strategy'
import { EnzymeSettings } from 'enzyme-core'

export class BasicExtractor extends BaseExtractor {
	strategy = DQLStrategy.Basic
	constructor(
		public app: App,
		public settings: EnzymeSettings,
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

		let doTrim = this.settings.trimFolders?.some((folder) => {
			if (file) {
				return file.path.includes(folder)
			}
		})

		if (doTrim) {
			const startSectionBoundary = Math.max(
				0,
				(metadata.sections?.length ?? 0) - 5
			)
			const fiveSectionBoundary =
				metadata.sections[startSectionBoundary].position.start.offset
			contents = contents.substring(fiveSectionBoundary)
		}

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
