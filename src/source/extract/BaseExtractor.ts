import {
	BlockCache,
	CachedMetadata,
	TFile,
	parseLinktext,
	ReferenceCache,
	App
} from 'obsidian'
import * as _path from 'path'
import { BlockRefSubstitution } from '../../types'
import { StrategyMetadata } from 'notebook/ReasonAgent'
import { DQLStrategy, DQLStrategyDescriptions } from 'source/extract/Strategy'

export type ParsedContent = {
	title: string
	path: string
	mtime: number
	referenceWindows: string[]
}

export type PreparedContents = {
	contents: string
	metadata: CachedMetadata
}

export type FileContents = {
	file: string
	last_modified_date: string
	contents: string
	substitutions: BlockRefSubstitution[]
	tags?: string[]
}

export abstract class BaseExtractor {
	app: App
	strategy: DQLStrategy
	abstract extract(
		file?: TFile,
		metadata?: CachedMetadata,
		strategy?: StrategyMetadata
	): Promise<any>

	/**
	 * Renders the source block for a given strategy.
	 * @param strategy
	 */
	async renderSourceBlock(strategy: StrategyMetadata): Promise<string> {
		let dqlPart = ''
		if (strategy.dql) {
			dqlPart = `\`\`\`dataview\n${strategy.dql}\n\`\`\`\n`
		}

		const preamblePart = strategy.sourcePreamble
			? `\n**Preamble**: ${strategy.sourcePreamble}\n`
			: ''
		return `### Source:\n${dqlPart}**Strategy**: ${this.description()}${preamblePart}\n`
	}

	description() {
		return DQLStrategyDescriptions[DQLStrategy[this.strategy]]
	}

	/**
	 * Substitutes block references within the content.
	 * This method scans the provided content for block reference markers (e.g., ^blockid)
	 * and replaces them with Obsidian-style block reference links (![[title#^blockid]]).
	 * It also generates and substitutes temporary placeholders for these block references
	 * which can be used for further processing.
	 *
	 * @param title The title of the file where the block references are located.
	 * @param contents The content string containing the block references to be substituted.
	 * @returns An object containing the array of block reference substitutions and the modified content.
	 */
	substituteBlockReferences(
		title: string,
		contents: string
	): { substitutions: BlockRefSubstitution[]; contents: string } {
		// Replace any reference strings (^blockid) with block reference (![[file#^blockid]])
		const blockRefRegex = /\^([a-zA-Z0-9]+)/g
		const blockRefs = contents.match(blockRefRegex)
		let substitutions: BlockRefSubstitution[] = []
		if (blockRefs) {
			for (const blockRef of blockRefs) {
				const blockRefString = `![[${title}#${blockRef}]]`
				const templateString = `%${Math.random().toString(16).slice(2, 6)}%`
				substitutions.push({
					template: templateString,
					block_reference: blockRefString
				})
				contents = contents.replace(blockRef, templateString)
			}
		}

		// additional cleaning which helps disambiguate markers for the agent
		let cleanContents = contents.replace(/\[.*?\]\(.*?\)/g, '')

		return {
			substitutions: substitutions,
			contents: cleanContents
		}
	}

	/**
	 * Cleans the contents of a file by removing frontmatter, code blocks, and other irrelevant content.
	 *
	 * @param contents The content string to be cleaned.
	 * @returns The cleaned content string.
	 */
	cleanContents(contents: string): string {
		// Get what's after frontmatter
		const frontmatterRegex = /---\n(.*?)\n---/s
		const frontmatterMatch = contents.match(frontmatterRegex)
		if (frontmatterMatch) {
			contents = contents.substring(frontmatterMatch[0].length)
		}

		// Remove code blocks
		contents = contents.replace(/```[\s\S]*?```/g, '').trim()

		return contents
	}

	/**
	 * Retrieves the content of an embedded block or section from a file.
	 *
	 * @param reference The reference cache object containing the link to the embedded content.
	 * @returns A Promise that resolves to the content of the embedded block or section.
	 */
	async getEmbedContent(reference: ReferenceCache): Promise<string> {
		try {
			const pathOfEmbed = parseLinktext(reference.link)
			const tfile: TFile = this.app.metadataCache.getFirstLinkpathDest(
				pathOfEmbed.path,
				'/'
			)

			if (!tfile.extension.includes('md')) {
				return ''
			}

			const metadata: CachedMetadata | null =
				this.app.metadataCache.getFileCache(tfile)

			let fullContent = await this.app.vault.cachedRead(tfile)

			if (pathOfEmbed.subpath && pathOfEmbed.subpath.startsWith('#^')) {
				const blockId: string = pathOfEmbed.subpath.substring(2)
				const block: BlockCache = metadata?.blocks[blockId]
				return fullContent.substring(
					block.position.start.offset,
					block.position.end.offset
				)
			} else if (!pathOfEmbed.subpath || pathOfEmbed.subpath === '') {
				// Return the full content if no subpath is provided
				return fullContent
			} else {
				return ''
			}
		} catch (exception) {
			console.error(`Failed to get embed: ${exception.message}`)
			return ''
		}
	}

	/**
	 * Replaces embed references in the content with the actual embedded content.
	 *
	 * This method iterates over each embed reference found in the metadata, retrieves the content
	 * for that reference, and replaces the reference in the original content with the retrieved content.
	 * Block references within the embed content are also substituted for markers.
	 * It adjusts the offset for each subsequent replacement to account for the change in content length
	 * after each replacement.
	 *
	 * @param contents The original content containing embed references.
	 * @param metadata The metadata object containing embeds and their positions.
	 * @returns A Promise that resolves to an object containing the modified content and an array of block reference substitutions.
	 */
	async replaceEmbeds(
		contents: string,
		metadata: CachedMetadata
	): Promise<{ contents: string; substitutions: BlockRefSubstitution[] }> {
		let newOffset = 0
		const allSubstitutions: BlockRefSubstitution[] = []

		// Sort embeds by start position (if not already)
		if (metadata.embeds) {
			metadata.embeds = metadata.embeds.sort(
				(a, b) => a.position.start.offset - b.position.start.offset
			)
		}

		for (let embed of metadata?.embeds || []) {
			if (
				embed.original.includes('.jpg') ||
				embed.original.includes('.excalidraw')
			) {
				continue
			}

			var embedContent = await this.getEmbedContent(embed)

			if (embedContent === '') {
				continue
			}

			const basename = embed.link.split('#')[0]

			// If there are block references in the embed, we need to substitute them
			// before adding the embed to the content
			const { contents: substitutedEmbedContent, substitutions } =
				this.substituteBlockReferences(basename, embedContent)

			allSubstitutions.push(...substitutions)

			let renderedEmbed = `\nExcerpt from: ${basename} -- \n\n> ${substitutedEmbedContent.split('\n').join('\n> ')}\n`
			const markerHash = Math.random().toString(16).substring(4, 8)
			const marker = `%${markerHash}%` // TODO this may lead to a lot of stale markers if there are multiple references to the same file, but that's okay for now
			renderedEmbed += `${marker}\n`

			allSubstitutions.push({
				template: marker,
				block_reference: embed.original
			})

			contents =
				contents.slice(0, newOffset + embed.position.start.offset) +
				renderedEmbed +
				contents.slice(newOffset + embed.position.end.offset)

			newOffset +=
				renderedEmbed.length -
				(embed.position.end.offset - embed.position.start.offset)
		}
		return { contents, substitutions: allSubstitutions }
	}
}
