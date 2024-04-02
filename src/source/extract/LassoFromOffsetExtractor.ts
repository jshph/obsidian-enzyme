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

		for (let topic of topics) {
			// Return whole file if it's in frontmatter
			if (
				topic.startsWith('#') &&
				metadata.frontmatter?.tags?.toString().includes(topic)
			) {
				// TODO just gets the first ~200 words of the doc... not very robust but we don't want to eat tokens
				referenceWindows.push(
					contents.substring(0, Math.min(contents.length, 800))
				)
				break
			} else {
				// Otherwise, there may be multiple references to that tag or link throughout the doc; extract all of the refs and their windows
				if (topic.startsWith('#')) {
					for (let tag of metadata.tags || []) {
						if (tag.tag === topic) {
							referenceWindows.push(
								this.lassoContentFromOffset(contents, tag.position, 1, 500)
							)
						}
					}
				} else if (topic.startsWith('[[')) {
					for (let link of metadata.links || []) {
						if (link.original === topic) {
							referenceWindows.push(
								this.lassoContentFromOffset(contents, link.position, 1, 500)
							)
						}
					}
				}
			}
		}

		// If this is a book, there may be LOTS of the same ref mentioned. Grab the most recent 8.
		referenceWindows = referenceWindows.slice(
			Math.max(0, referenceWindows.length - 8)
		)

		return referenceWindows
	}
}
