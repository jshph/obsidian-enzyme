import { App, CachedMetadata, TFile } from 'obsidian'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { AllBacklinkersExtractor } from './AllBacklinkersExtractor'
import { TrimToEndExtractor } from './TrimToEndExtractor'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { ReasonSettings } from '../../settings/ReasonSettings'
import { DQLStrategy } from '../../reason-node/SourceReasonNodeBuilder'
import { DataviewApi } from 'obsidian-dataview'
import { SingleBacklinkerExtractor } from './SingleBacklinkerExtractor'

// Delegates to other extractors based on lists of patterns. Is itself an extractor.
export class ExtractorDelegator extends BaseExtractor {
	// extractors can be recursive / call other extractors. Named for what they do, not what folders they are for.
	allBacklinkersExtractor: AllBacklinkersExtractor
	trimToEndExtractor: TrimToEndExtractor
	singleBacklinkerExtractor: SingleBacklinkerExtractor

	constructor(
		public app: App,
		dataviewAPI: DataviewApi,
		public settings: ReasonSettings,
		public lassoExtractor: LassoFromOffsetExtractor = new LassoFromOffsetExtractor()
	) {
		super()
		this.allBacklinkersExtractor = new AllBacklinkersExtractor(
			app,
			this.lassoExtractor,
			dataviewAPI
		)
		this.trimToEndExtractor = new TrimToEndExtractor(app)
		this.singleBacklinkerExtractor = new SingleBacklinkerExtractor(
			app,
			dataviewAPI,
			this.lassoExtractor
		)
	}

	async extract(
		file: TFile,
		metadata: CachedMetadata,
		strategy?: string,
		evergreen?: string
	): Promise<FileContents[]> {
		switch (
			strategy // TODO put the block reference in the json itself so the small model can use it
		) {
			case DQLStrategy[DQLStrategy.AllEvergreenReferrers]:
				return this.allBacklinkersExtractor.extract(file, metadata)
			case DQLStrategy[DQLStrategy.LongContent]:
				return this.trimToEndExtractor.extract(file, metadata)
			case DQLStrategy[DQLStrategy.SingleEvergreenReferrer]:
				return this.singleBacklinkerExtractor.extract(
					file,
					metadata,
					strategy,
					evergreen
				)
			default:
				let rawContents = await this.app.vault.cachedRead(file)
				rawContents = await this.replaceEmbeds(rawContents, metadata)
				rawContents = this.cleanContents(rawContents)

				let { substitutions, contents } = this.substituteBlockReferences(
					file.basename,
					rawContents
				)

				return [
					{
						file: file.basename,
						last_modified_date: new Date(file.stat.mtime).toLocaleDateString(),
						contents: contents,
						substitutions: substitutions
					}
				]
		}
	}
}
