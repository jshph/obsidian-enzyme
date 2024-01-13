import { App, TFile, CachedMetadata } from 'obsidian'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { DataviewApi } from 'obsidian-dataview'
import { BaseExtractor, FileContents } from './BaseExtractor'

export class AllBacklinkersExtractor extends BaseExtractor {
	/*
	 * This extractor looks for references of the evergreen note/tag across all files. If it finds them, it fetches all recent blocks that referenced it. If not, it just returns the whole file
	 */
	constructor(
		public app: App,
		public lassoExtractor: LassoFromOffsetExtractor,
		public dataviewAPI: DataviewApi
	) {
		super()
	}

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
				let rawReferrerContents = await this.app.vault.cachedRead(referrerFile)

				rawReferrerContents = this.cleanContents(rawReferrerContents)

				const referrerMetadata: CachedMetadata =
					this.app.metadataCache.getFileCache(referrerFile)

				const referrerContentsReplacedEmbeds = await this.replaceEmbeds(
					rawReferrerContents,
					referrerMetadata
				)

				const referenceContentWindows =
					await this.lassoExtractor.extractReferenceWindows(
						referrerContentsReplacedEmbeds,
						referrerMetadata,
						[`[[${file.basename}]]`]
					)

				const substituted = referenceContentWindows.map((window) => {
					return this.substituteBlockReferences(referrerFile.basename, window)
				})

				return {
					file: referrerFile.basename,
					referrer_last_modified_date: new Date(
						referrerFile.stat.mtime
					).toLocaleDateString(),
					references: substituted.map((substitution) => substitution.contents),
					substitutions: substituted.flatMap(
						(substitution) => substitution.substitutions
					)
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
