import { App, CachedMetadata, TFile } from 'obsidian'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { AllBacklinkersExtractor } from './AllBacklinkersExtractor'
import { TrimToEndExtractor } from './TrimToEndExtractor'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { EnzymeSettings } from '../../settings/EnzymeSettings'
import { DQLStrategy } from './Strategy'
import { DataviewApi } from 'obsidian-dataview'
import { SingleBacklinkerExtractor } from './SingleBacklinkerExtractor'
import {
	RecentMentionsExtractor,
	RecentMentionsStrategyMetadata
} from './RecentMentionsExtractor'
import { BasicExtractor } from './BasicExtractor'
import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'

/**
 * The `ExtractorDelegator` class manages the delegation of content extraction to specific extractors. It itself is an extractor.
 */
export class ExtractorDelegator extends BaseExtractor {
	// extractors can be recursive / call other extractors. Named for what they do, not what folders they are for.
	allBacklinkersExtractor: AllBacklinkersExtractor
	trimToEndExtractor: TrimToEndExtractor
	singleBacklinkerExtractor: SingleBacklinkerExtractor
	recentMentionsExtractor: RecentMentionsExtractor
	basicExtractor: BasicExtractor

	constructor(
		public app: App,
		dataviewAPI: DataviewApi,
		public settings: EnzymeSettings,
		public lassoExtractor: LassoFromOffsetExtractor = new LassoFromOffsetExtractor()
	) {
		super()
		this.allBacklinkersExtractor = new AllBacklinkersExtractor(
			app,
			dataviewAPI,
			this.lassoExtractor
		)
		this.trimToEndExtractor = new TrimToEndExtractor(app)
		this.singleBacklinkerExtractor = new SingleBacklinkerExtractor(
			app,
			dataviewAPI,
			this.lassoExtractor
		)
		this.basicExtractor = new BasicExtractor(app, dataviewAPI)
		this.recentMentionsExtractor = new RecentMentionsExtractor(
			app,
			dataviewAPI,
			this.singleBacklinkerExtractor,
			this.basicExtractor
		)
	}

	override async renderSourceBlock(
		strategy: StrategyMetadata
	): Promise<string> {
		// Switch between different strategies
		switch (strategy.strategy) {
			case DQLStrategy[DQLStrategy.AllEvergreenReferrers]:
				return await this.allBacklinkersExtractor.renderSourceBlock(strategy)
			case DQLStrategy[DQLStrategy.LongContent]:
				return await this.trimToEndExtractor.renderSourceBlock(strategy)
			case DQLStrategy[DQLStrategy.SingleEvergreenReferrer]:
				return await this.singleBacklinkerExtractor.renderSourceBlock(strategy)
			case DQLStrategy[DQLStrategy.RecentMentions]:
				return await this.recentMentionsExtractor.renderSourceBlock(
					strategy as RecentMentionsStrategyMetadata
				)
			default:
				return await this.basicExtractor.renderSourceBlock(strategy)
		}
	}

	/**
	 * Extracts content from a file based on the specified strategy and evergreen status.
	 * This method delegates to specific extractors depending on the strategy provided.
	 * If no strategy is specified, it defaults to extracting the raw contents of the file,
	 * performing embed replacements, and cleaning the contents.
	 *
	 * @param file - The file from which to extract content.
	 * @param metadata - The cached metadata of the file.
	 * @param strategy - The strategy to use for content extraction (optional).
	 * @returns A Promise that resolves to an array of FileContents objects.
	 */
	async extract(
		file?: TFile,
		metadata?: CachedMetadata,
		strategy?: StrategyMetadata
	): Promise<FileContents[]> {
		switch (
			strategy.strategy // TODO put the block reference in the json itself so the small model can use it
		) {
			case DQLStrategy[DQLStrategy.AllEvergreenReferrers]:
				return this.allBacklinkersExtractor.extract(file, metadata)
			case DQLStrategy[DQLStrategy.LongContent]:
				return this.trimToEndExtractor.extract(file, metadata)
			case DQLStrategy[DQLStrategy.SingleEvergreenReferrer]:
				return this.singleBacklinkerExtractor.extract(file, metadata, strategy)
			case DQLStrategy[DQLStrategy.RecentMentions]:
				return this.recentMentionsExtractor.extract(
					null,
					null,
					strategy as RecentMentionsStrategyMetadata
				)
			default:
				return this.basicExtractor.extract(file, metadata)
		}
	}
}
