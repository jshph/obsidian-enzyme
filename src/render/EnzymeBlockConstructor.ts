import { StrategyMetadata } from '../notebook/ObsidianEnzymeAgent'
import { App } from 'obsidian'
import { EnzymeSettings } from '../settings/EnzymeSettings'
import { DQLStrategy } from '../source/extract/Strategy'
import * as yaml from 'yaml'

export const DEFAULT_PROMPT = 'Relate the mentions of $MENTIONS$ to each other.'

export enum EnzymeSourceType {
	Note,
	Tag,
	Folder
}

type EnzymeBlockContents = {
	prompt: string
	sources: StrategyMetadata[]
	choice?: {
		strategy: string
		line: number
	}
}

const ENTITY_PATTERN = /(\[\[[^\]]+\]\])(<\d+)?/g
const TAG_PATTERN = /(#[\w-]+(?:\/[\w-]+)*)(<\d+)?/g
const FOLDER_PATTERN = /([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)(<\d+)?/g
const ENTITY_MATCH_PATTERN = /(\[\[.*\]\])(<(\d+))?/
const TAG_MATCH_PATTERN = /(#[\w-]+(?:\/[\w-]+)*)(<(\d+))?/
const FOLDER_MATCH_PATTERN =
	/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)(<(\d+))?/

export class EnzymeBlockConstructor {
	constructor(
		public app: App,
		public settings: EnzymeSettings
	) {}

	defaultSourcesForContents(contents: string): StrategyMetadata[] {
		const entities = this.extractSourcesFromRawContents(contents)
		if (entities.length > 0) {
			return entities.map((entity) => {
				const doUseBasicExtraction = this.settings.basicExtractionFolders?.some(
					(folder) => {
						if (entity.type === EnzymeSourceType.Note) {
							const link = this.app.metadataCache.getFirstLinkpathDest(
								entity.entity.replace(/\[\[|\]\]/g, ''),
								''
							)
							if (!link) {
								return false
							}
							return link.path.startsWith(folder)
						} else if (entity.type === EnzymeSourceType.Folder) {
							return entity.entity.startsWith(folder)
						}
					}
				)

				const doUseLongContent = this.settings.trimFolders?.some((folder) => {
					if (entity.type === EnzymeSourceType.Note) {
						const link = this.app.metadataCache.getFirstLinkpathDest(
							entity.entity.replace(/\[\[|\]\]/g, ''),
							''
						)
						if (!link) {
							return false
						}
						return link.path.startsWith(folder)
					} else if (entity.type === EnzymeSourceType.Folder) {
						return entity.entity.startsWith(folder)
					}
				})

				let excludedSuffix = ''
				for (const pattern of this.settings.exclusionPatterns) {
					if (pattern.startsWith('#')) {
						if (excludedSuffix.length > 0) {
							excludedSuffix += ' AND '
						}
						excludedSuffix += ` !contains(file.tags, "${pattern}")`
					} else {
						if (excludedSuffix.length > 0) {
							excludedSuffix += ' AND '
						}
						excludedSuffix += ` !contains(file.path, "${pattern}")`
					}
				}

				switch (entity.type) {
					case EnzymeSourceType.Note:
						if (doUseBasicExtraction) {
							return {
								strategy: DQLStrategy[DQLStrategy.Basic],
								dql: `LIST WHERE file.link = ${entity.entity} ${excludedSuffix}`
							}
						} else if (doUseLongContent) {
							return {
								strategy: DQLStrategy[DQLStrategy.LongContent],
								dql: `LIST WHERE file.link = ${entity.entity} ${excludedSuffix}`
							}
						} else {
							return {
								strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
								dql: `LIST WHERE contains(file.outlinks, ${entity.entity}) AND ${excludedSuffix} SORT file.ctime DESC LIMIT ${entity.limit}`,
								evergreen: entity.entity
							}
						}
					case EnzymeSourceType.Tag:
						return {
							strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
							dql: `LIST WHERE contains(file.tags, "${entity.entity}") AND ${excludedSuffix} SORT file.ctime DESC LIMIT ${entity.limit}`,
							evergreen: entity.entity
						}
					case EnzymeSourceType.Folder:
						let folder = entity.entity.slice(0, -1)

						if (doUseBasicExtraction) {
							return {
								strategy: DQLStrategy[DQLStrategy.Basic],
								dql: `LIST FROM "${folder}" ${excludedSuffix ? 'WHERE ' + excludedSuffix : ''} SORT file.ctime DESC LIMIT ${entity.limit}`,
								folder: folder
							}
						} else {
							// Default to long content
							return {
								strategy: DQLStrategy[DQLStrategy.LongContent],
								dql: `LIST FROM "${folder}" ${excludedSuffix ? 'WHERE ' + excludedSuffix : ''} SORT file.ctime DESC LIMIT ${entity.limit}`,
								folder: folder
							}
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

	extractSourcesFromRawContents(
		contents: string
	): { entity: string; type: EnzymeSourceType; limit: number }[] {
		const entities = []
		const entityMatches: RegExpMatchArray | null =
			contents.match(ENTITY_PATTERN)
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
		const folderMatches: RegExpMatchArray | null =
			contents.match(FOLDER_PATTERN)
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

	promptOnlyContainsEntities(prompt: string): boolean {
		// Replace tags and entities with empty strings
		const strippedPrompt = prompt
			.replace(ENTITY_PATTERN, '')
			.replace(TAG_PATTERN, '')
			.replace(FOLDER_PATTERN, '')
			.trim()

		const entities = this.extractSourcesFromRawContents(prompt)
		return strippedPrompt.length === 0 && entities.length > 0
	}

	cleanPrompt(prompt: string): string {
		return prompt.replace(/(<\d+)?/g, '').trim()
	}

	processRawContents(
		rawContents: string,
		excludeNoEntityDefault: boolean = false
	): {
		sources: StrategyMetadata[]
		prompt: string
	} {
		let prompt: string
		let sources = this.defaultSourcesForContents(rawContents)

		// If the prompt doesn't contain any entities, remove the default recent mentions strategy
		// used if this is a followup prompt, i.e. no need to fetch additioanl sources
		if (excludeNoEntityDefault) {
			sources = sources.filter(
				(s) => s.strategy !== DQLStrategy[DQLStrategy.RecentMentions]
			)
		}

		if (this.promptOnlyContainsEntities(rawContents)) {
			prompt = 'Relate the '
			let parts = ''
			if (sources.filter((s) => s.evergreen).length > 0) {
				parts += `mentions of ${sources.map((s) => s.evergreen).join(' and ')}`
			}
			if (
				sources.filter(
					(s) => s.strategy === DQLStrategy[DQLStrategy.LongContent]
				).length > 0
			) {
				if (parts.length > 0) {
					parts += ' and '
				}
				const folders = sources
					.filter((s) => s.strategy === DQLStrategy[DQLStrategy.LongContent])
					.map((s) => s.folder)
					.filter((folder): folder is string => folder !== undefined)
				parts += `contents in ${folders.join(' and ')}`
			}
			prompt += parts + ' to each other.'
		} else {
			prompt = this.cleanPrompt(rawContents)
		}

		return {
			sources,
			prompt
		}
	}
}

/**
 * Parses the contents of a Enzyme code block as YAML, producing an Aggregator (with guidance + sources, or by ID)
 *
 * @param contents the raw contents, which we'll try to parse as valid YAML syntax.
 * @returns metadata, i.e. Aggregator metadata
 */
export function parseEnzymeBlockContents(
	contents: string
): EnzymeBlockContents {
	let prompt
	let sources

	try {
		const parsedYaml = yaml.parse(contents.replace(/\t/g, '    '))
		// First mode is having a UI picker that selects a default aggregator
		if (parsedYaml?.choice) {
			// Assume that if choice is present, we always present the user with a UI button to select between "default" sources, and we return EnzymeBlockContents with that chosen source and a flag
			// We treat choice identically to "strategy" but limited to the strategy's default parameters
			let guidance = ''
			if (parsedYaml?.guidance) {
				guidance = parsedYaml.guidance
			}

			// Get the line number where choice was defined
			const choiceLine = contents
				.split('\n')
				.findIndex((line) => line.includes('choice:'))

			return {
				prompt: guidance,
				sources: [],
				choice: {
					strategy: parsedYaml.choice, // No validation
					line: choiceLine
				}
			}
		}

		// Other mode is having a list of sources
		if (parsedYaml?.sources?.length > 0) {
			sources = parsedYaml.sources.map((source) => {
				return source as StrategyMetadata
			})
			prompt = parsedYaml.guidance
			return {
				prompt,
				sources
			}
		} else if (parsedYaml?.guidance) {
			return {
				prompt: parsedYaml.guidance,
				sources: []
			}
		} else {
			return {
				prompt: contents,
				sources: []
			}
		}
	} catch (e) {
		// By default return empty sources. Currently the caller sets this to RecentMentions; needs to be differentiated from valid YAML
		return {
			prompt: contents,
			sources: []
		}
	}
}
