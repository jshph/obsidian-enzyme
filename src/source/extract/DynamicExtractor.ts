import { App, CachedMetadata, TFile } from 'obsidian'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { DataviewApi } from 'obsidian-dataview'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'
import { DQLStrategy } from './Strategy'
import { SingleBacklinkerExtractor } from './SingleBacklinkerExtractor'
import { EnzymeSettings } from 'enzyme-core'
import { BasicExtractor } from './BasicExtractor'

export class DynamicExtractor extends BaseExtractor {
	basicExtractor: BasicExtractor
	strategy = DQLStrategy.Dynamic
	constructor(
		public app: App,
		public settings: EnzymeSettings,
		public dataviewAPI: DataviewApi,
		public lassoExtractor: LassoFromOffsetExtractor,
		public singleBacklinkerExtractor: SingleBacklinkerExtractor
	) {
		super()
		this.basicExtractor = new BasicExtractor(app, settings, dataviewAPI)
	}

	/**
	 * Extracts content snippets from all files that reference a specific evergreen note or tag, as well as the contents of the file.
	 *
	 * @param file - The file to extract from.
	 * @param metadata - The cached metadata of the file.
	 * @param strategy - The strategy to use for extraction.
	 * @returns A promise resolving to an array of content snippets with backlink references.
	 */
	async extract(
		file: TFile,
		metadata: CachedMetadata,
		strategy: StrategyMetadata
	): Promise<FileContents[]> {
		// Handle evergreen if it's a note (i.e. the source that is being referenced)
		let evergreenContents: FileContents[] = []
		if (strategy.evergreen && strategy.evergreen.includes('[[')) {
			const evergreenFile = this.app.metadataCache.getFirstLinkpathDest(
				strategy.evergreen.replace(/\[\[|\]\]/g, ''),
				''
			)
			if (evergreenFile) {
				evergreenContents = await this.basicExtractor.extract(
					evergreenFile,
					metadata
				)
			}

			if (evergreenContents.length > 0 && !evergreenContents[0].contents) {
				// Don't include the source if it's empty
				evergreenContents = []
			}
		}

		let backlinkers: TFile[] = (
			await this.dataviewAPI.tryQuery(strategy.dql)
		).values
			.map((path: any) => path.path)
			.map((path: string) => {
				return this.app.metadataCache.getFirstLinkpathDest(path, '/')
			})

		let allReferenceContents = await Promise.all(
			backlinkers.map(async (referrerFile: TFile) => {
				let contents = await this.app.vault.cachedRead(referrerFile)

				const referrerMetadata: CachedMetadata =
					this.app.metadataCache.getFileCache(referrerFile)

				const replaced = await this.replaceEmbeds(contents, referrerMetadata)
				contents = replaced.contents
				let substitutions = replaced.substitutions

				contents = this.cleanContents(contents)

				const referenceContentWindows =
					await this.lassoExtractor.extractReferenceWindows(
						contents,
						referrerMetadata,
						[`[[${file.basename}]]`]
					)

				const referenceContents = referenceContentWindows.map((window) => {
					return this.substituteBlockReferences(referrerFile.basename, window)
				})

				return {
					file: referrerFile.basename,
					referrer_last_modified_date: new Date(
						referrerFile.stat.mtime
					).toLocaleDateString(),
					references: referenceContents.map((c) => c.contents),
					substitutions: [
						...referenceContents.flatMap((c) => c.substitutions),
						...substitutions
					]
				}
			})
		)

		let contents = allReferenceContents.map((content) => {
			return {
				file: content.file,
				last_modified_date: content.referrer_last_modified_date,
				contents: content.references.join('\n\n'),
				substitutions: content.substitutions
			}
		})

		return [...evergreenContents, ...contents]
	}
}
