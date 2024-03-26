import { App, TFile, CachedMetadata } from 'obsidian'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { DataviewApi } from 'obsidian-dataview'
import { BaseExtractor, FileContents } from './BaseExtractor'

export class AllBacklinkersExtractor extends BaseExtractor {
	constructor(
		public app: App,
		public lassoExtractor: LassoFromOffsetExtractor,
		public dataviewAPI: DataviewApi
	) {
		super()
	}

	/**
	 * Extracts content based on references to an evergreen note/tag.
	 * If references are found, it retrieves the most recent blocks that mentioned the evergreen note/tag.
	 * If no references are found, it returns the entire content of the file.
	 *
	 * @param file - The file to search for backlinks.
	 * @param metadata - The cached metadata of the file.
	 * @returns A promise that resolves to an array of FileContents, each representing a backlinker's content.
	 */
	async extract(
		file: TFile,
		metadata: CachedMetadata
	): Promise<FileContents[]> {
		let backlinkers: TFile[] = (
			await this.dataviewAPI.tryQuery(
				`LIST WHERE contains(file.outlinks, [[${file.name}]]) LIMIT 5 SORT file.mtime DESC`
			)
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

		return contents
	}
}
