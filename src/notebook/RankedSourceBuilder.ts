import { CanvasData } from 'obsidian/canvas'
import OpenAI from 'openai'
import { App } from 'obsidian'
import { DataviewSource } from './ReasonAgent'
import { AIClient } from './AIClient'

type RankedSourceResponse = {
	explanation: string
	ids: string[]
	rephrasedUserPrompt?: string
}

export type RankedAggregators = {
	explanation: string
	aggregators: AggregatorMetadata[]
}

export type AggregatorMetadata = {
	aggregatorId?: string
	sources: DataviewSource[]
	prompt: string
}

/**
 * Retrieves metadata for a specific aggregator from the canvas data.
 *
 * This function searches for a node in the canvas data that matches the provided aggregator ID,
 * extracts the prompt from the node's file metadata, and then finds all sources connected to
 * this aggregator node. It constructs and returns an `AggregatorMetadata` object containing
 * the ID, sources, and prompt for the aggregator.
 */
export function getAggregatorMetadata(
	aggregatorId: string,
	canvasData: CanvasData,
	app: App
): AggregatorMetadata {
	const aggregatorNode = canvasData.nodes.find(
		(node) => node.file.match(/\/([^\.]+).md/)?.[1] === aggregatorId
	)
	const prompt = app.metadataCache.getFileCache(
		app.metadataCache.getFirstLinkpathDest(aggregatorNode.file, '/')
	).frontmatter?.guidance

	const sources = canvasData.edges
		.filter((edge) => edge.toNode === aggregatorNode.id)
		.map((edge) => {
			const fromNode = canvasData.nodes.find(
				(node) => node.id === edge.fromNode
			)
			const frontmatter = app.metadataCache.getFileCache(
				app.metadataCache.getFirstLinkpathDest(fromNode.file, '/')
			).frontmatter

			return {
				id: fromNode.file.match(/\/([^\.]+).md/)?.[1],
				dql: frontmatter.dql,
				strategy: frontmatter.strategy,
				evergreen: frontmatter.evergreen
			} as DataviewSource
		})

	return {
		aggregatorId,
		sources,
		prompt
	} as AggregatorMetadata
}

/**
 * `Ranker` is a class responsible for ranking aggregator nodes based on their relevance and quality.
 * It utilizes an AI client to process and rank the aggregators by sending a prompt that includes
 * user input and the metadata of the aggregators. The ranking process involves multiple attempts
 * to ensure reliability and accuracy of the results.
 *
 * @property {AIClient} aiClient - The AI client used to communicate with the AI model.
 * @property {() => string} getModel - A function that returns the model name to be used for the AI client.
 * @property {string} systemPrompt - A system-level prompt that provides context or instructions to the AI.
 *
 * @method constructor - Initializes the `Ranker` with the AI client, model getter function, and system prompt.
 * @method rankAggregators - Ranks the given aggregators based on the provided user prompt and returns the ranked results.
 */
export class Ranker {
	constructor(
		public aiClient: AIClient,
		public getModel: () => string,
		private systemPrompt: string
	) {}

	/**
	 * Ranks the given aggregators based on the provided user prompt.
	 * It sends the prompt to the AI client, which processes the information
	 * and returns a ranked list of aggregator nodes. The function will attempt
	 * to get a successful response up to 3 times before giving up.
	 *
	 * @param {AggregatorMetadata[]} aggregators - An array of aggregator metadata objects.
	 * @param {string} prompt - The user input prompt to guide the AI ranking process.
	 * @returns {Promise<RankedAggregators>} A promise that resolves to the ranked aggregators.
	 */
	async rankAggregators(
		aggregators: AggregatorMetadata[],
		prompt: string
	): Promise<RankedAggregators> {
		let retryCount = 0
		let rankedSources: RankedSourceResponse

		let userPrompt = `
    ## User Prompt:
    ${prompt}

    ## Sources
    ${aggregators
			.map((aggregator) => {
				return `Aggregator ID: ${aggregator.aggregatorId}\nGuidance: ${
					aggregator.prompt
				}\nSources:\n${aggregator.sources
					.map((source) => JSON.stringify(source))
					.join('\n')}`
			})
			.join('\n\n')}
    `

		// Make prompt from sources

		while (retryCount < 3) {
			try {
				const res = await this.aiClient.createCompletion({
					model: this.getModel(),
					messages: [
						{
							role: 'system',
							content: this.systemPrompt
						},
						{
							role: 'user',
							content: userPrompt
						}
					]
				})
				if ('choices' in res) {
					rankedSources = JSON.parse(
						res.choices[0].message.content.match(/({.*})/s)[0]
					) as RankedSourceResponse
				} else {
					throw new Error('Invalid response type')
				}
				break
			} catch (error) {
				retryCount++
			}
		}

		return {
			explanation: rankedSources.explanation,
			aggregators: rankedSources.ids.unique().map((id) => {
				const aggregator = aggregators.find(
					(aggregator) => aggregator.aggregatorId === id
				)
				if (rankedSources.rephrasedUserPrompt) {
					aggregator.prompt = rankedSources.rephrasedUserPrompt
				}
				return aggregator
			})
		} as RankedAggregators
	}
}
