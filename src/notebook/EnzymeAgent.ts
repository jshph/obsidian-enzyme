import { Aggregator } from '../aggregator/Aggregator'
import { CandidateRetriever } from '../source/retrieve/CandidateRetriever'
import {
	ChatMessageWithMetadata,
	SynthesisContainer
} from '../render/SynthesisContainer'
import { BlockRefSubstitution } from '../types'
import { AIClient } from './AIClient'
import { prompts } from './prompts'
import { App, Notice } from 'obsidian'

export type StrategyMetadata = {
	strategy: string
	dql?: string
	id?: string
	sourcePreamble?: string // Optional -- a preamble to be included about the source
	evergreen?: string
}

export type SystemPrompts = {
	aggregatorSystemPrompt: string
	aggregatorInstructions: string
}

export async function getSystemPrompts(): Promise<SystemPrompts> {
	return prompts as SystemPrompts
}

/**
 * The `EnzymeAgent` class is a central component of the Enzyme plugin, responsible for orchestrating
 * the enzymeing process within Obsidian. It manages the interaction between different enzymeing
 * systems and the user interface, providing methods to synthesize content
 */
export class EnzymeAgent {
	aggregator: Aggregator

	constructor(
		public app: App,
		public aiClient: AIClient,
		public candidateRetriever: CandidateRetriever,
		public getModel: () => string,
		public checkSetup: () => boolean,
		private systemPrompts: SystemPrompts
	) {
		this.aggregator = new Aggregator(
			this.aiClient,
			getModel,
			this.systemPrompts.aggregatorSystemPrompt,
			this.systemPrompts.aggregatorInstructions
		)
	}

	private async retrieve(sources: StrategyMetadata[]): Promise<{
		sourceContents: string[]
		substitutions: BlockRefSubstitution[]
	}> {
		let results = (
			await Promise.all(
				sources.map(async (source) => {
					const fileContents = await this.candidateRetriever.retrieve(source)
					const flatContents = fileContents.flat().map((content) => {
						return {
							content: content.contents,
							substitutions: content.substitutions
						}
					})
					return flatContents
				})
			)
		).flat()

		let sourceContents = results.map((result) => result.content)
		let substitutions = results.map((result) => result.substitutions).flat()

		return {
			sourceContents,
			substitutions
		}
	}

	/**
	 * Processes the synthesis of content based on user interactions and synthesis plans.
	 * It appends generated content to the editor and handles user feedback.
	 *
	 * @param {SynthesisContainer} synthesisContainer - The container managing editor interactions.
	 * @returns {Promise<void>} - A promise that resolves when the synthesis process is complete.
	 */
	async synthesize(synthesisContainer: SynthesisContainer): Promise<void> {
		let allSubstitutions: BlockRefSubstitution[] = []

		// Get all user and synthesis turns as context
		let messages = [] as ChatMessageWithMetadata[]

		const messagesToHere = synthesisContainer.getMessagesToHere()
		for (const msg of messagesToHere) {
			if (msg.role === 'user' && msg.content.length > 0) {
				let curUserPrompt = msg.metadata.prompt
				let sources = msg.metadata.sources
				let retrieval = await this.retrieve(sources)
				let sourceContents = retrieval.sourceContents
				let concatenatedContents = sourceContents.join('\n\n').trim()

				allSubstitutions.push(...retrieval.substitutions)

				let message = ''
				if (concatenatedContents.length > 0) {
					message = `Sources:\n${concatenatedContents}\n\n`
				}
				message += `Guidance: ${curUserPrompt}`

				messages.push({
					role: 'user',
					content: message,
					metadata: undefined
				})
			} else if (msg.role === 'assistant') {
				let { contents, substitutions } = substituteBlockEmbeds(msg.content)
				allSubstitutions.push(...substitutions)
				messages.push({
					role: 'assistant',
					content: contents,
					metadata: undefined
				})
			}
		}
		// Append reminder instructions to the last user prompt (assume the last message is a user message)
		messages[messages.length - 1].content +=
			`\n\nContinue the conversation and remember the rules:\n${this.systemPrompts.aggregatorInstructions}`

		new Notice('Synthesizing content...')

		let synthesisGenerator = this.aggregator.generateFromMessages(messages)

		// Generate while replacing %templates% with actual block references

		let firstChunkWasSent = false
		let partialMarker = ''
		// console.log(allSubstitutions)
		// TODO refactor / separate
		for await (const part of await synthesisGenerator) {
			if (!firstChunkWasSent) {
				synthesisContainer.appendText('\n\n')
				firstChunkWasSent = true
			}
			let textToAppend = ''
			let currentPart = partialMarker + part
			partialMarker = ''

			const markerMatches = [...currentPart.matchAll(/%[a-zA-Z0-9]*%/g)]
			let lastIndex = 0

			markerMatches.forEach((match) => {
				const markerIndex = match.index || 0
				textToAppend += currentPart.slice(lastIndex, markerIndex)
				const substitution = allSubstitutions.find(
					(sub) => sub.template === match[0]
				)
				if (substitution) {
					textToAppend += substitution.block_reference
				} else {
					textToAppend += match[0]
				}
				lastIndex = markerIndex + match[0].length
			})

			if (lastIndex < currentPart.length) {
				const tail = currentPart.slice(lastIndex)
				const potentialStartOfMarker = tail.lastIndexOf('%')
				if (potentialStartOfMarker !== -1) {
					partialMarker = tail.slice(potentialStartOfMarker)
					textToAppend += tail.slice(0, potentialStartOfMarker)
				} else {
					textToAppend += tail
				}
			}

			if (textToAppend) {
				synthesisContainer.appendText(textToAppend)
			}
		}
	}
}

/**
 * Replaces block embeds in the content with unique placeholders.
 * It scans the content for block embeds, represented by the syntax `![[block]]`,
 * and replaces each with a temporary placeholder of the form `%randomHash%`.
 *
 * @param {string} contents - The string content containing block embeds.
 * @returns An object containing the processed `contents` with placeholders and an array of `substitutions`.
 *          Each substitution has a `template` (the placeholder) and the original `block_reference`.
 */
function substituteBlockEmbeds(contents: string): {
	contents: string
	substitutions: BlockRefSubstitution[]
} {
	let substitutions: BlockRefSubstitution[] = []

	const blockMatches = [...contents.matchAll(/!\[\[([^\]]+)\]\]/g)]
	let lastIndex = 0
	let newContents = contents
	if (blockMatches.length > 0) {
		newContents = ''
		blockMatches.forEach((match) => {
			const blockIndex = match.index || 0
			newContents += contents.slice(lastIndex, blockIndex)
			const blockReference = match[1]
			const randomHash = Math.random().toString(16).substring(2, 6)
			newContents += `%${randomHash}%`
			substitutions.push({
				template: `%${randomHash}%`,
				block_reference: `![[${blockReference}]]`
			})
			lastIndex = blockIndex + match[0].length
		})
		newContents += contents.slice(lastIndex)
	}

	return {
		contents: newContents,
		substitutions: substitutions
	}
}
