import { App, CachedMetadata, TFile } from 'obsidian'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { EnzymeSettings } from 'enzyme-core'
import { DQLStrategy } from './Strategy'
import { DataviewApi } from 'obsidian-dataview'
import { SingleBacklinkerExtractor } from './SingleBacklinkerExtractor'
import {
	RecentMentionsExtractor,
	RecentMentionsStrategyMetadata
} from './RecentMentionsExtractor'
import { BasicExtractor } from './BasicExtractor'
import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'
import { DynamicExtractor } from './DynamicExtractor'

/**
 * The `ExtractorDelegator` class manages the delegation of content extraction to specific extractors. It itself is an extractor.
 */
export class ExtractorDelegator extends BaseExtractor {
	// extractors can be recursive / call other extractors. Named for what they do, not what folders they are for.
	singleBacklinkerExtractor: SingleBacklinkerExtractor
	recentMentionsExtractor: RecentMentionsExtractor
	basicExtractor: BasicExtractor
	dynamicExtractor: DynamicExtractor

	constructor(
		public app: App,
		dataviewAPI: DataviewApi,
		public settings: EnzymeSettings,
		public lassoExtractor: LassoFromOffsetExtractor = new LassoFromOffsetExtractor()
	) {
		super()
		this.singleBacklinkerExtractor = new SingleBacklinkerExtractor(
			app,
			dataviewAPI,
			this.lassoExtractor
		)
		this.basicExtractor = new BasicExtractor(app, settings, dataviewAPI)
		this.recentMentionsExtractor = new RecentMentionsExtractor(
			app,
			dataviewAPI,
			this.singleBacklinkerExtractor,
			this.basicExtractor
		)
		this.dynamicExtractor = new DynamicExtractor(
			app,
			settings,
			dataviewAPI,
			this.lassoExtractor,
			this.singleBacklinkerExtractor
		)
	}

	override async renderSourceBlock(
		strategy: StrategyMetadata
	): Promise<string> {
		// Switch between different strategies
		switch (strategy.strategy) {
			case DQLStrategy[DQLStrategy.SingleEvergreenReferrer]:
				return await this.singleBacklinkerExtractor.renderSourceBlock(strategy)
			case DQLStrategy[DQLStrategy.Dynamic]:
				return await this.dynamicExtractor.renderSourceBlock(strategy)
			case DQLStrategy[DQLStrategy.Basic]:
				return await this.basicExtractor.renderSourceBlock(strategy)
			default:
				return await this.recentMentionsExtractor.renderSourceBlock(
					strategy as RecentMentionsStrategyMetadata
				)
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
		if (strategy?.strategy === DQLStrategy[DQLStrategy.Basic]) {
			return this.basicExtractor.extract(file, metadata, strategy)
		} else if (
			strategy?.strategy === DQLStrategy[DQLStrategy.SingleEvergreenReferrer]
		) {
			return this.singleBacklinkerExtractor.extract(file, metadata, strategy)
		} else {
			return this.dynamicExtractor.extract(file, metadata, strategy)
		}
	}
}
