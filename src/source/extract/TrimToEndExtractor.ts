import { App, CachedMetadata, TFile } from 'obsidian'
import { BaseExtractor, FileContents } from './BaseExtractor'
import { DQLStrategy } from 'source/extract/Strategy'

// Designed to handle notes that usually long, i.e. because they are append-only, such as Readwise Book notes
export class TrimToEndExtractor extends BaseExtractor {
	strategy = DQLStrategy.LongContent
	constructor(public app: App) {
		super()
	}

	/**
	 * Extracts the last part of the file, starting from the last 5 sections.
	 *
	 * @param file - The file to extract from.
	 * @param metadata - The cached metadata of the file.
	 * @returns A promise resolving to an array of FileContents, each representing the contents of a file.
	 */
	async extract(
		file: TFile,
		metadata: CachedMetadata
	): Promise<FileContents[]> {
		let contents = await this.app.vault.cachedRead(file)

		const replaced = await this.replaceEmbeds(contents, metadata)
		contents = replaced.contents
		let substitutions = replaced.substitutions

		contents = this.cleanContents(contents)

		const startSectionBoundary = Math.max(
			0,
			(metadata.sections?.length ?? 0) - 5
		)
		const fiveSectionBoundary =
			metadata.sections[startSectionBoundary].position.start.offset
		contents = contents.substring(fiveSectionBoundary)

		const substituted = this.substituteBlockReferences(file.basename, contents)
		contents = substituted.contents
		substitutions = [...substitutions, ...substituted.substitutions]

		return [
			{
				file: file.basename,
				last_modified_date: new Date(file.stat.mtime).toLocaleDateString(),
				contents,
				substitutions
			}
		]
	}
}
