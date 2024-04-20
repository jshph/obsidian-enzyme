import OpenAI from 'openai'
import {
	AggregatorMetadata,
	RankedAggregators,
	Ranker,
	getAggregatorMetadata
} from './RankedSourceBuilder'
import { Aggregator } from '../aggregator/Aggregator'
import { CandidateRetriever } from '../source/retrieve/CandidateRetriever'
import {
	AssistantMessageMetadata,
	SynthesisContainer,
	SynthesisMessageMetadata,
	SynthesisPlanMessageMetadata
} from '../render/SynthesisContainer'
import { BlockRefSubstitution } from '../types'
import { ReasonNodeType } from '../types'
import { App, Notice, TFile } from 'obsidian'
import { CanvasLoader, DEFAULT_CANVAS_PATH } from '../notebook/CanvasLoader'
import { ChatCompletionMessage } from '../types'
import { BaseReasonNodeBuilder } from '../reason-node/BaseReasonNodeBuilder'
import { AIClient } from './AIClient'
import { prompts } from './prompts'

export type StrategyMetadata = {
	name: string
	dql?: string
}

export type DataviewSource = {
	id?: string
	strategy: StrategyMetadata
	sourcePreamble?: string // Optional -- a preamble to be included about the source
}

export type SystemPrompts = {
	ranker: string
	aggregatorSystemPrompt: string
	aggregatorInstructions: string
}

export async function getSystemPrompts(): Promise<SystemPrompts> {
	return prompts as SystemPrompts
}

export type SynthesisPlan = {
	rankedAggregators?: RankedAggregators
}

/**
 * The `ReasonAgent` class is a central component of the Reason plugin, responsible for orchestrating
 * the reasoning process within Obsidian. It manages the interaction between different reasoning
 * systems and the user interface, providing methods to perform synthesis, ranking, and aggregation
 * of information.
 */
export class ReasonAgent {
	ranker: Ranker
	aggregator: Aggregator

	constructor(
		public app: App,
		public canvasLoader: CanvasLoader,
		public aiClient: AIClient,
		public candidateRetriever: CandidateRetriever,
		public getModel: () => string,
		public checkSetup: () => boolean,
		public sourceReasonNodeBuilder: BaseReasonNodeBuilder<any>,
		public aggregatorReasonNodeBuilder: BaseReasonNodeBuilder<any>,
		private systemPrompts: SystemPrompts
	) {
		this.ranker = new Ranker(aiClient, getModel, this.systemPrompts.ranker)
		this.aggregator = new Aggregator(
			this.aiClient,
			getModel,
			this.systemPrompts.aggregatorSystemPrompt,
			this.systemPrompts.aggregatorInstructions
		)
	}

	/**
	 * Retrieves metadata for all aggregator nodes within the canvas.
	 * This method first reloads the canvas to ensure it has the latest data.
	 * It then filters the canvas nodes to find those that are marked as Aggregator nodes
	 * based on their frontmatter role. For each aggregator node found, it extracts
	 * the metadata which includes the aggregator's ID and other relevant information
	 * from the canvas and the application context.
	 *
	 * @returns {Promise<AggregatorMetadata[]>} A promise that resolves to an array of AggregatorMetadata objects.
	 */
	async aggregatorsInCanvas(): Promise<AggregatorMetadata[]> {
		await this.canvasLoader.reload()
		const canvasData = this.canvasLoader.canvasData
		const aggregators: AggregatorMetadata[] = canvasData.nodes
			.filter((node) => {
				const file = this.app.metadataCache.getFirstLinkpathDest(node.file, '/')

				if (!(file instanceof TFile)) {
					return false
				}

				return (
					this.app.metadataCache.getFileCache(file)?.frontmatter?.role ===
					ReasonNodeType[ReasonNodeType.Aggregator]
				)
			})
			.map((node) => {
				return getAggregatorMetadata(
					node.file.match(/\/([^\.]+).md/)?.[1],
					canvasData,
					this.app
				)
			})
		return aggregators
	}

	/**
	 * Retrieves metadata for all aggregator nodes within the canvas.
	 * This method first reloads the canvas to ensure it has the latest data.
	 * It then filters the canvas nodes to find those that are marked as Aggregator nodes
	 * based on their frontmatter role. For each aggregator node found, it extracts
	 * the metadata which includes the aggregator's ID and other relevant information
	 * from the canvas and the application context.
	 *
	 * @returns {Promise<AggregatorMetadata[]>} A promise that resolves to an array of AggregatorMetadata objects.
	 */
	async rankAggregators(
		synthesisContainer: SynthesisContainer,
		aggregators: AggregatorMetadata[],
		prompt: string
	): Promise<RankedAggregators> {
		const cancelPlaceholderFn = synthesisContainer.waitPlaceholder(
			'🧠 Finding source material...'
		)

		const ranked = await this.ranker.rankAggregators(aggregators, prompt)
		cancelPlaceholderFn()

		return ranked
	}

	private async retrieve(sources: DataviewSource[]): Promise<{
		sourceContents: string[]
		substitutions: BlockRefSubstitution[]
	}> {
		let results = (
			await Promise.all(
				sources.map(async (source) => {
					source = source as DataviewSource
					const retrievalParams = {
						sourcePreamble: source.sourcePreamble,
						strategy: source.strategy
					}
					const fileContents =
						await this.candidateRetriever.retrieve(retrievalParams)
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
		synthesisContainer.renderMetadata([
			{
				id: Math.random().toString(16).slice(6),
				assistantMessageType: 'synthesis'
			} as SynthesisMessageMetadata
		])

		let allSubstitutions: BlockRefSubstitution[] = []

		// Get all user and synthesis turns as context
		let messages = [] as ChatCompletionMessage[]

		const messagesToHere = synthesisContainer.getMessagesToHere()
		for (const msg of messagesToHere) {
			if (msg.role === 'user' && msg.content.length > 0) {
				if (msg.metadata) {
					let curUserPrompt = (msg.metadata[0] as SynthesisPlanMessageMetadata)
						.prompt
					let sources = (msg.metadata[0] as SynthesisPlanMessageMetadata)
						.sources
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
						content: message
					})
				}
			} else if (
				msg.role === 'assistant' &&
				msg.metadata[0].assistantMessageType === 'synthesis'
			) {
				let { contents, substitutions } = substituteBlockEmbeds(msg.content)
				allSubstitutions.push(...substitutions)
				messages.push({
					role: 'assistant',
					content: contents
				})
			}
		}
		// Append reminder instructions to the last user prompt (assume the last message is a user message)
		messages[messages.length - 1].content +=
			`\n\nRemember the rules:\n${this.systemPrompts.aggregatorInstructions}`

		const cancelPlaceholderFn =
			synthesisContainer.waitPlaceholder('🧠 Synthesizing...')

		let synthesisGenerator = this.aggregator.generateFromMessages(messages)

		// Generate while replacing %templates% with actual block references

		let firstChunkWasSent = false
		let partialMarker = ''
		// console.log(allSubstitutions)
		// TODO refactor / separate
		for await (const part of await synthesisGenerator) {
			if (!firstChunkWasSent) {
				cancelPlaceholderFn()
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

		synthesisContainer.finalize()
	}

	/**
	 * Constructs a synthesis plan based on the messages within the synthesis container.
	 * It filters user messages, combines their content or associated prompts into a single string,
	 * and checks for the most recent synthesis plan message. If such a message exists, it uses the
	 * metadata from that message to create a synthesis plan. Otherwise, it creates a default synthesis
	 * plan with the combined user prompts and an empty sources array.
	 *
	 * @param {SynthesisContainer} synthesisContainer - The container holding the synthesis context.
	 * @returns {Promise<SynthesisPlan>} A promise that resolves to a synthesis plan object.
	 */
	async makeSynthesisPlan(
		synthesisContainer: SynthesisContainer
	): Promise<SynthesisPlan> {
		let messages: ChatCompletionMessage[] = []

		let messagesToHere = synthesisContainer.getMessagesToHere()

		let combinedUserPrompts = messagesToHere
			.filter((msg) => msg.role === 'user' && msg.content.length > 0)
			.map((msg) => {
				if (!msg.metadata) {
					return msg.content
				} else {
					return (msg.metadata as SynthesisPlanMessageMetadata[])[0].prompt
				}
			})
			.join('. ')

		messages.push({
			role: 'user',
			content: combinedUserPrompts
		})

		// Check whether the most recent messages contain SynthesisPlans made in the editor rather than from Canvas
		// If so, use those instead of the ones from Canvas
		const synthesisPlanMessage = messagesToHere
			.slice()
			.reverse()
			.find(
				(msg) =>
					msg.metadata?.length > 0 &&
					msg.metadata[0].assistantMessageType === 'synthesisPlan'
			)

		if (synthesisPlanMessage) {
			const synthesisPlanMetadata = synthesisPlanMessage
				.metadata[0] as SynthesisPlanMessageMetadata
			return {
				rankedAggregators: {
					aggregators: [
						{
							prompt: combinedUserPrompts,
							sources: synthesisPlanMetadata.sources
						}
					],
					explanation: ''
				}
			}
		}

		const aggregatorCandidates = await this.aggregatorsInCanvas()
		const rankedSources = await this.rankAggregators(
			synthesisContainer,
			aggregatorCandidates,
			combinedUserPrompts
		)

		return {
			rankedAggregators: rankedSources
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
