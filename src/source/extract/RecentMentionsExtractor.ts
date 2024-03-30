import { DataviewApi } from 'obsidian-dataview'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { App, TFile } from 'obsidian'
import { SingleBacklinkerExtractor } from './SingleBacklinkerExtractor'
import { DQLStrategy } from 'reason-node/SourceReasonNodeBuilder'
import { BasicExtractor } from './BasicExtractor'

export type RecentMentionsMetadata = {
	numReadwiseFiles: number
	numOtherFiles: number
}

const NUM_READWISE_FILES = 10
const NUM_OTHER_FILES = 100
const NUM_TAGS = 25
const MAX_NUM_FILES_PER_TAG = 10
export class RecentMentionsExtractor extends BaseExtractor {
	constructor(
		public app: App,
		public dataviewAPI: DataviewApi,
		public singleBacklinkerExtractor: SingleBacklinkerExtractor,
		public basicExtractor: BasicExtractor
	) {
		super()
	}

	/**
	 * Extracts the most recently modified files for the most common tags / mentioned links. They're sorted by the
	 * number of files and then by the most recently modified file.
	 *
	 * Each file is then passed to the SingleBacklinkerExtractor along with the mentioned entity.
	 * That extractor then extracts the neighboring context of the mentioned entity in the file.
	 *
	 * @returns A promise resolving to an array of FileContents, each representing the contents of a file.
	 */
	async extract(): Promise<FileContents[]> {
		// Get 10 most recently modified files from Readwise
		const files = await this.dataviewAPI.tryQuery(`
      TABLE WITHOUT ID file.link, file.mtime, file.tags, file.outlinks FROM "Readwise" SORT file.mtime DESC LIMIT ${NUM_READWISE_FILES}
    `)

		// Get 40 most recently created files from the rest of the vault
		const files2 = await this.dataviewAPI.tryQuery(`
      TABLE WITHOUT ID file.link, file.mtime, file.tags, file.outlinks FROM ""
      WHERE !contains(file.path, "Readwise")
      SORT file.ctime DESC LIMIT ${NUM_OTHER_FILES}
    `)

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
		const groupedFiles: {
			[key: string]: { mention: string; filepath: string; mtime: number }[]
		} = {}
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
		const sortedMentions = Object.keys(groupedFiles).sort(
			(a, b) =>
				groupedFiles[b].length - groupedFiles[a].length ||
				groupedFilesMTime[b] - groupedFilesMTime[a]
		)

		console.log('Top mentions', sortedMentions)

		const topPromises = sortedMentions
			.slice(0, NUM_TAGS)
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
					return this.basicExtractor.extract(
						tfile,
						metadataCache,
						DQLStrategy[DQLStrategy.Basic],
						undefined
					)
				} else {
					// Extract the neighboring context of the mention in the file
					return this.singleBacklinkerExtractor.extract(
						tfile,
						metadataCache,
						DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
						mention
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
