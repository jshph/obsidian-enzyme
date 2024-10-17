import { CachedMetadata, Pos } from 'obsidian'

/**
 * The `LassoFromOffsetExtractor` class extracts content from a file based on a given offset.
 * It can be used to extract content around a specific position in a file.
 */
export class LassoFromOffsetExtractor {
	// need a new method that parses the metadata out of a string... because dql will produce string output

	findNthBlockToOffset(contents: string, offset: number, n: number = 2) {
		// Find all matches of "\n\n" up to the offset
		const matches = [...contents.substring(0, offset).matchAll(/\n\n/g)]

		if (matches.length >= n) {
			return matches[matches.length - n].index
		}

		return Number.MIN_VALUE
	}

	findNthBlockFromOffset(contents: string, offset: number, n: number = 2) {
		// Find all matches of "\n\n" from the offset
		const matches = [
			...contents.substring(offset, contents.length).matchAll(/\n\n/g)
		]

		if (matches.length >= n) {
			return matches[n - 1].index + offset + 1
		}

		return Number.MAX_VALUE
	}

	lassoContentFromOffset(
		contents: string,
		offset: Pos,
		blockSize: number,
		characterFallOff: number
	) {
		const startBlockBound: number = this.findNthBlockToOffset(
			contents,
			offset.start.offset,
			blockSize
		)
		const endBlockBound: number = this.findNthBlockFromOffset(
			contents,
			offset.end.offset,
			blockSize
		)

		return contents.substring(
			Math.max(0, startBlockBound - characterFallOff),
			Math.min(contents.length, endBlockBound + characterFallOff)
		)
	}
	async extractReferenceWindows(
		contents: string,
		metadata: CachedMetadata,
		topics: string[]
	): Promise<string[]> {
		let referenceWindows: string[] = []

		for (const topic of topics) {
			if (this.isTopicInFrontmatter(topic, metadata)) {
				referenceWindows.push(this.getInitialContentSnippet(contents))
				break
			} else {
				this.extractReferencesForTopic(
					topic,
					metadata,
					contents,
					referenceWindows
				)
			}
		}

		return this.limitReferenceWindows(referenceWindows)
	}

	private isTopicInFrontmatter(
		topic: string,
		metadata: CachedMetadata
	): boolean {
		return (
			topic.startsWith('#') &&
			metadata.frontmatter?.tags?.toString().includes(topic.slice(1))
		)
	}

	private getInitialContentSnippet(contents: string): string {
		return contents.substring(0, Math.min(contents.length, 800))
	}

	private extractReferencesForTopic(
		topic: string,
		metadata: CachedMetadata,
		contents: string,
		referenceWindows: string[]
	): void {
		if (topic.startsWith('#')) {
			this.extractTagReferences(
				topic,
				metadata.tags,
				contents,
				referenceWindows
			)
		} else if (topic.startsWith('[[')) {
			this.extractLinkReferences(
				topic,
				metadata.links,
				contents,
				referenceWindows
			)
		}
	}

	private extractTagReferences(
		topic: string,
		tags: { tag: string; position: Pos }[] | undefined,
		contents: string,
		referenceWindows: string[]
	): void {
		tags?.forEach((tag) => {
			if (tag.tag === topic) {
				referenceWindows.push(
					this.lassoContentFromOffset(contents, tag.position, 3, 200)
				)
			}
		})
	}

	private extractLinkReferences(
		topic: string,
		links: { original: string; position: Pos }[] | undefined,
		contents: string,
		referenceWindows: string[]
	): void {
		links?.forEach((link) => {
			if (link.original === topic) {
				referenceWindows.push(
					this.lassoContentFromOffset(contents, link.position, 3, 200)
				)
			}
		})
	}

	private limitReferenceWindows(referenceWindows: string[]): string[] {
		return referenceWindows.slice(Math.max(0, referenceWindows.length - 8))
	}
}
