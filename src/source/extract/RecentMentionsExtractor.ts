import { DataviewApi } from 'obsidian-dataview'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { App, CachedMetadata, TFile } from 'obsidian'
import { SingleBacklinkerExtractor } from './SingleBacklinkerExtractor'
import { DQLStrategy } from 'source/extract/Strategy'
import { BasicExtractor } from './BasicExtractor'
import { StrategyMetadata } from 'notebook/EnzymeAgent'

export type RecentMentionsStrategyMetadata = StrategyMetadata & {
	numReadwiseFiles: number
	numOtherFiles: number
}

const NUM_READWISE_FILES = 10
const NUM_OTHER_FILES = 20
const NUM_TAGS = 8
const MAX_NUM_FILES_PER_TAG = 10
const DQL_READWISE =
	'TABLE WITHOUT ID file.link, file.mtime, file.tags, file.outlinks FROM "Readwise" SORT file.mtime DESC LIMIT {numReadwiseFiles}'
const DQL_OTHER = `
TABLE WITHOUT ID file.link, file.mtime, file.tags, file.outlinks FROM ""
WHERE !contains(file.path, "Readwise")
SORT file.ctime DESC LIMIT {numOtherFiles}`

type KeyedFile = {
	[key: string]: { mention: string; filepath: string; mtime: number }[]
}

export class RecentMentionsExtractor extends BaseExtractor {
	strategy = DQLStrategy.RecentMentions
	constructor(
		public app: App,
		public dataviewAPI: DataviewApi,
		public singleBacklinkerExtractor: SingleBacklinkerExtractor,
		public basicExtractor: BasicExtractor
	) {
		super()
	}

	override async renderSourceBlock(
		strategy: RecentMentionsStrategyMetadata
	): Promise<string> {
		strategy.numReadwiseFiles = strategy.numReadwiseFiles ?? NUM_READWISE_FILES
		strategy.numOtherFiles = strategy.numOtherFiles ?? NUM_OTHER_FILES

		const { sortedMentions } = await this.getTopMentions(
			strategy.numReadwiseFiles,
			strategy.numOtherFiles
		)

		const formattedMentions = '- ' + sortedMentions.join('\n- ')
		const mentionPart = `**Top mentioned entities**:\n${formattedMentions}`

		return (await super.renderSourceBlock(strategy)) + mentionPart
	}

	private async getTopMentions(
		numReadwiseFiles: number,
		numOtherFiles: number
	): Promise<{
		sortedMentions: string[]
		groupedFiles: KeyedFile
	}> {
		let files = { values: [] }
		// Get most recently modified files from Readwise
		const readwiseFolder = this.app.vault.getAbstractFileByPath('Readwise')
		if (readwiseFolder) {
			files = await this.dataviewAPI.tryQuery(
				DQL_READWISE.replace('{numReadwiseFiles}', numReadwiseFiles.toString())
			)
		}

		// Get most recently created files from the rest of the vault
		const files2 = await this.dataviewAPI.tryQuery(
			DQL_OTHER.replace('{numOtherFiles}', numOtherFiles.toString())
		)

		const flattenedFiles: {
			mention: string
			filepath: string
			mtime: number
		}[] = [...files.values, ...files2.values].flatMap(
			([link, mtime, tags, outlinks]) => {
				const formatMention = (mention, type) => ({
					mention:
						type === 'tag'
							? mention
							: `[[${this.app.vault.getAbstractFileByPath(mention).name}]]`,
					filepath: link.path,
					mtime: mtime.ts
				})

				const filterAndFormat = (items, filter, type) =>
					items
						.filter((item) => !filter.some((f) => item.includes(f)))
						.map((item) => formatMention(item, type))

				const tagFilter = ['#Readwise', '#excalidraw']
				const linkFilter = ['daily/', 'Readwise/']

				return [
					...filterAndFormat(tags, tagFilter, 'tag'),
					...filterAndFormat(
						outlinks
							.map((outlink) => outlink.path)
							.filter((p) => p.includes('.md')),
						linkFilter,
						'link'
					)
				]
			}
		)

		// Group by mentioned entity and get the most recently modified file for each mentioned entity
		const groupedFiles: KeyedFile = {}
		const groupedFilesMTime = {}
		flattenedFiles.forEach((file) => {
			if (!groupedFiles[file.mention]) {
				groupedFiles[file.mention] = []
			}
			groupedFiles[file.mention].push(file)
			const curMax = groupedFilesMTime[file.mention]
				? groupedFilesMTime[file.mention]
				: 0
			groupedFilesMTime[file.mention] = Math.max(file.mtime, curMax)
		})

		// Sort entities by number of files and then by most recently modified
		const sortedMentions = Object.keys(groupedFiles)
			.sort(
				(a, b) =>
					groupedFiles[b].length - groupedFiles[a].length ||
					groupedFilesMTime[b] - groupedFilesMTime[a]
			)
			.slice(0, NUM_TAGS)

		return { sortedMentions, groupedFiles }
	}

	/**
	 * Extracts the most recently modified files for the most common tags / mentioned links. They're sorted by the
	 * number of files and then by the most recently modified file.
	 *
	 * Each file is then passed to the SingleBacklinkerExtractor along with the mentioned entity.
	 * That extractor then extracts the neighboring context of the mentioned entity in the file.
	 *
	 * @param strategy - Metadata for the strategy, including the number of Readwise files and other files to consider.
	 *
	 * @returns A promise resolving to an array of FileContents, each representing the contents of a file.
	 */
	async extract(
		file: TFile,
		metadata: CachedMetadata,
		strategy: RecentMentionsStrategyMetadata
	): Promise<FileContents[]> {
		const { sortedMentions, groupedFiles } = await this.getTopMentions(
			strategy.numReadwiseFiles ?? NUM_READWISE_FILES,
			strategy.numOtherFiles ?? NUM_OTHER_FILES
		)

		const topPromises = sortedMentions
			.flatMap((mention, index) => {
				return groupedFiles[mention]
					.sort((a, b) => b.mtime - a.mtime)
					.slice(0, MAX_NUM_FILES_PER_TAG)
					.map((file) => ({ mention, file }))
			})
			.map(async ({ mention, file }) => {
				const tfile = this.app.vault.getAbstractFileByPath(file.filepath)
				if (!tfile || !(tfile instanceof TFile)) {
					return []
				}
				const metadataCache = this.app.metadataCache.getFileCache(tfile)

				// If it's a tag, it could've been mentioned in frontmatter, and we'll want to handle that by extracting the whole file
				if (
					mention.contains('#') &&
					metadataCache?.frontmatter?.tags &&
					metadataCache?.frontmatter?.tags?.includes(mention.slice(1))
				) {
					// Extract entire contents
					return await this.basicExtractor.extract(tfile, metadataCache, {
						strategy: DQLStrategy[DQLStrategy.Basic]
					} as StrategyMetadata)
				} else {
					// Extract the neighboring context of the mention in the file
					return await this.singleBacklinkerExtractor.extract(
						tfile,
						metadataCache,
						{
							strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
							evergreen: mention
						}
					)
				}
			})

		const top = await Promise.all(topPromises).then((results) => results.flat())

		// Multiple mentions of the same file can be merged
		const mergedTop: FileContents[] = [].concat(
			...Object.values(
				top.reduce((acc: Record<string, FileContents[]>, fileContent) => {
					const key = fileContent.file
					if (!acc[key]) {
						if (fileContent.contents.trim() !== '') {
							acc[key] = [fileContent]
						}
					} else {
						let hasOverlap = false
						// Check for partial matches and concatenate if necessary
						for (let existing of acc[key]) {
							const existingContent = existing.contents
							const newContent = fileContent.contents
							existing.substitutions.push(...fileContent.substitutions)
							// Handle edge case where file contents are empty
							if (!newContent.trim()) {
								hasOverlap = true
								break
							}
							if (
								existingContent.includes(newContent) ||
								newContent.includes(existingContent)
							) {
								// Full overlap, no need to concatenate
								hasOverlap = true
								break
							} else {
								// Check for partial overlap
								const overlapIndex = existingContent.lastIndexOf(
									newContent.substring(0, 10) // TODO this is a naive approach, should be improved
								)
								if (
									overlapIndex !== -1 &&
									overlapIndex + newContent.length > existingContent.length
								) {
									// Partial overlap found, concatenate the non-overlapping part
									existing.contents =
										existingContent.substring(0, overlapIndex) + newContent
									hasOverlap = true
									break
								}
							}
						}
						if (!hasOverlap) {
							// No overlap, keep the items separate
							acc[key].push(fileContent)
						}
					}
					return acc
				}, {})
			)
		)

		mergedTop.sort((a, b) => {
			return (
				Date.parse(b.last_modified_date.split('/').reverse().join('-')) -
				Date.parse(a.last_modified_date.split('/').reverse().join('-'))
			)
		})

		return mergedTop.slice(0, 25) // Limit to 30 files for now
	}
}
