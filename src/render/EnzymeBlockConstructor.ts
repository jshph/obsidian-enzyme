import { StrategyMetadata } from 'notebook/EnzymeAgent'
import { DQLStrategy } from 'source/extract/Strategy'

export const DEFAULT_PROMPT = 'Relate the mentions of $MENTIONS$ to each other.'

export enum EnzymeSourceType {
	Note,
	Tag,
	Folder
}

const ENTITY_PATTERN = /(\[\[[^\]]+\]\])(<\d+)?/g
const TAG_PATTERN = /(#[\w-]+(?:\/[\w-]+)*)(<\d+)?/g
const FOLDER_PATTERN = /([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)(<\d+)?/g
const ENTITY_MATCH_PATTERN = /(\[\[.*\]\])(<(\d+))?/
const TAG_MATCH_PATTERN = /(#[\w-]+(?:\/[\w-]+)*)(<(\d+))?/
const FOLDER_MATCH_PATTERN =
	/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)(<(\d+))?/

function defaultSourcesForContents(contents: string): StrategyMetadata[] {
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
				case EnzymeSourceType.Tag:
					return {
						strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
						dql: `LIST WHERE contains(file.tags, "${entity.entity}") SORT file.ctime DESC LIMIT ${entity.limit}`,
						evergreen: entity.entity
					}
				case EnzymeSourceType.Folder:
					let folder = entity.entity.slice(0, -1)
					return {
						strategy: DQLStrategy[DQLStrategy.LongContent], // TODO
						dql: `LIST FROM "${folder}" SORT file.ctime DESC LIMIT ${entity.limit}`
					}
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

function extractSourcesFromRawContents(
	contents: string
): { entity: string; type: EnzymeSourceType; limit: number }[] {
	const entities = []
	const entityMatches: RegExpMatchArray | null = contents.match(ENTITY_PATTERN)
	if (entityMatches) {
		for (const entity of entityMatches) {
			const entityMatch = entity.match(ENTITY_MATCH_PATTERN)
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
	const tagMatches: RegExpMatchArray | null = contents.match(TAG_PATTERN)
	if (tagMatches) {
		for (const tag of tagMatches) {
			const entityMatch = tag.match(TAG_MATCH_PATTERN)
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
	const folderMatches: RegExpMatchArray | null = contents.match(FOLDER_PATTERN)
	if (folderMatches) {
		for (const folder of folderMatches) {
			// Find the index of the match in the original content
			const startIndex = contents.indexOf(folder)
			// Check if the character before the match is not '#'
			if (startIndex === 0 || contents[startIndex - 1] !== '#') {
				const entityMatch = folder.match(FOLDER_MATCH_PATTERN)
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
		.replace(ENTITY_PATTERN, '')
		.replace(TAG_PATTERN, '')
		.replace(FOLDER_PATTERN, '')
		.trim()

	const entities = extractSourcesFromRawContents(prompt)
	return strippedPrompt.length === 0 && entities.length > 0
}
function cleanPrompt(prompt: string): string {
	return prompt.replace(/(<\d+)?/g, '').trim()
}

export function processRawContents(
	rawContents: string,
	excludeNoEntityDefault: boolean = false
): {
	sources: StrategyMetadata[]
	prompt: string
} {
	let prompt: string
	let sources = defaultSourcesForContents(rawContents)

	// If the prompt doesn't contain any entities, remove the default recent mentions strategy
	// used if this is a followup prompt, i.e. no need to fetch additioanl sources
	if (excludeNoEntityDefault) {
		sources = sources.filter(
			(s) => s.strategy !== DQLStrategy[DQLStrategy.RecentMentions]
		)
	}

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
