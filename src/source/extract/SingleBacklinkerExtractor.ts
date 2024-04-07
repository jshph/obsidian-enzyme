import { App, CachedMetadata, TFile } from 'obsidian'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { DataviewApi } from 'obsidian-dataview'
import { LassoFromOffsetExtractor } from './LassoFromOffsetExtractor'
import { StrategyMetadata } from 'notebook/ReasonAgent'
import { DQLStrategy } from 'reason-node/SourceReasonNodeBuilder'

export type SingleBacklinkerStrategyMetadata = StrategyMetadata & {
	evergreen: string
	dql?: string // Optional since it's only present if we are not calling this extractor directly, but rather through a list of files
}

export class SingleBacklinkerExtractor extends BaseExtractor {
	strategy = DQLStrategy.SingleEvergreenReferrer
	constructor(
		public app: App,
		public dataviewAPI: DataviewApi,
		public lassoExtractor: LassoFromOffsetExtractor
	) {
		super()
	}

	override async renderSourceBlock(
		strategy: SingleBacklinkerStrategyMetadata,
		sourcePreamble: string
	): Promise<string> {
		// If a DQL query is present, format it as a code block
		const dqlPart = `\`\`\`dataview\n${strategy.dql}\n\`\`\`\n`

		return super.renderSourceBlock(strategy, sourcePreamble) + dqlPart
	}

	/**
	 * Extracts content snippets from a file that reference a specific evergreen note or tag.
	 *
	 * @param file - The file to extract from.
	 * @param metadata - The cached metadata of the file.
	 * @param strategy - The strategy to use for extraction.
	 * @returns A promise resolving to an array of content snippets with backlink references.
	 */
	async extract(
		file: TFile,
		metadata: CachedMetadata,
		strategy: SingleBacklinkerStrategyMetadata
	): Promise<FileContents[]> {
		let contents = await this.app.vault.cachedRead(file)

		const replaced = await this.replaceEmbeds(contents, metadata)
		contents = replaced.contents
		let substitutions = replaced.substitutions

		const cleanedContents = this.cleanContents(contents)

		const referenceContentWindows =
			await this.lassoExtractor.extractReferenceWindows(
				cleanedContents,
				metadata,
				[strategy.evergreen]
			)

		const referenceContents = referenceContentWindows.map((window) => {
			return this.substituteBlockReferences(file.basename, window)
		})

		let allContents = {
			file: file.basename,
			last_modified_date: new Date(file.stat.mtime).toLocaleDateString(),
			contents: referenceContents.map((c) => c.contents).join('\n\n'),
			substitutions: [
				...referenceContents.flatMap((c) => c.substitutions),
				...substitutions
			]
		}

		return [allContents]
	}
}
