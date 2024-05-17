import { StrategyMetadata } from 'notebook/EnzymeAgent'
import { DQLStrategy } from 'source/extract/Strategy'

export const DEFAULT_PROMPT = 'Relate the mentions of $MENTIONS$ to each other.'

export enum EnzymeSourceType {
	Note,
	Tag,
	Folder
}

export function defaultSourcesForContents(
	contents: string
): StrategyMetadata[] {
	const entities = extractSourcesFromRawContents(contents)
	if (entities.length > 0) {
		return entities.map((entity) => {
			switch (entity.type) {
				case EnzymeSourceType.Note:
					return {
						strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
						dql: `LIST WHERE contains(file.outlinks, ${entity.entity}) SORT file.ctime DESC LIMIT ${entity.limit}`,
						evergreen: entity.entity
					}
					break
				case EnzymeSourceType.Tag:
					return {
						strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
						dql: `LIST WHERE contains(file.tags, "${entity.entity}") SORT file.ctime DESC LIMIT ${entity.limit}`,
						evergreen: entity.entity
					}
					break
				case EnzymeSourceType.Folder:
					let folder = entity.entity.slice(0, -1)
					return {
						strategy: DQLStrategy[DQLStrategy.LongContent], // TODO
						dql: `LIST FROM "${folder}" SORT file.ctime DESC LIMIT ${entity.limit}`
					}
					break
			}
		})
	} else {
		return [
			{
				strategy: DQLStrategy[DQLStrategy.RecentMentions]
			}
		]
	}
}

/**
 * Extracts entities from raw string if mentioned
 * @param contents
 * @returns
 */
export function extractSourcesFromRawContents(
	contents: string
): { entity: string; type: EnzymeSourceType; limit: number }[] {
	const entities = []
	const entityMatches: RegExpMatchArray | null = contents.match(
		/(\[\[[^\]]+\]\])(<\d+)?/g
	)
	if (entityMatches) {
		for (const entity of entityMatches) {
			const entityMatch = entity.match(/(\[\[.*\]\])(<(\d+))?/)
			if (entityMatch) {
				const entity = entityMatch[1]
				const limit = entityMatch[3] ? parseInt(entityMatch[3]) : 5
				entities.push({
					entity: entity,
					type: EnzymeSourceType.Note,
					limit: limit
				})
			}
		}
	}
	const tagMatches: RegExpMatchArray | null =
		contents.match(/(#[\w-\/]+)(<\d+)?/g)
	if (tagMatches) {
		for (const tag of tagMatches) {
			const entityMatch = tag.match(/(#[\w-\/]+)(<(\d+))?/)
			if (entityMatch) {
				const entity = entityMatch[1]
				const limit = entityMatch[3] ? parseInt(entityMatch[3]) : 5
				entities.push({
					entity: entity,
					type: EnzymeSourceType.Tag,
					limit: limit
				})
			}
		}
	}
	const folderMatches: RegExpMatchArray | null = contents.match(
		/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)(<\d+)?/g
	)
	if (folderMatches) {
		for (const folder of folderMatches) {
			// Ensure the match is not a tag with subtag (e.g., #tag/subtag)
			if (!folder.startsWith('#')) {
				const entityMatch = folder.match(
					/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)(<(\d+))?/
				)
				if (entityMatch) {
					const entity = entityMatch[1]
					const limit = entityMatch[3] ? parseInt(entityMatch[3]) : 5
					entities.push({
						entity: entity,
						type: EnzymeSourceType.Folder,
						limit: limit
					})
				}
			}
		}
	}
	return entities
}

function promptOnlyContainsEntities(prompt: string): boolean {
	// Replace tags and entities with empty strings
	const strippedPrompt = prompt
		.replace(/\[\[.*\]\](<\d+)?/g, '')
		.replace(/#(\w+)(<\d+)?/g, '')
		.replace(/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/(<\d+)?/g, '')
		.trim()

	const entities = extractSourcesFromRawContents(prompt)
	return strippedPrompt.length === 0 && entities.length > 0
}
function cleanPrompt(prompt: string): string {
	return prompt.replace(/(<\d+)?/g, '').trim()
}

export function processRawContents(rawContents: string): {
	sources: StrategyMetadata[]
	prompt: string
} {
	let prompt: string
	let sources = defaultSourcesForContents(rawContents)
	if (promptOnlyContainsEntities(rawContents)) {
		prompt = 'Relate the '
		let parts = ''
		if (sources.filter((s) => s.evergreen).length > 0) {
			parts += `mentions of ${sources.map((s) => s.evergreen).join(' and ')}`
		}
		if (
			sources.filter((s) => s.strategy === DQLStrategy[DQLStrategy.LongContent])
				.length > 0
		) {
			if (parts.length > 0) {
				parts += ' and '
			}
			parts += `contents in this folder`
		}
		prompt += parts + ' to each other.'
	} else {
		prompt = cleanPrompt(rawContents)
	}

	return {
		sources,
		prompt
	}
}
