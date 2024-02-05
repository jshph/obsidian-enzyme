import { App, Modal, Notice, TFile } from 'obsidian'
import { CanvasData } from 'obsidian/canvas'
import OpenAI from 'openai'
import { ReasonNodeType } from '../types'
import { createHash } from 'crypto'
import {
	ChatMessageWithMetadata,
	SynthesisPlanMessageMetadata
} from '../render/SynthesisContainer'
import { DEFAULT_BASE_REASON_PATH } from './CanvasLoader'
import localforage from 'localforage'
import { ChatCompletionMessage } from '../types'
import { BaseReasonNodeBuilder } from '../reason-node/BaseReasonNodeBuilder'
import { AIClient } from './AIClient'

export type SynthesisConstruction = {
	synthesis_constructions: {
		guidance_id: string
		guidance: string
		source_material: {
			id: string
			dql: string
			strategy: string
		}[]
	}[]
}

const HEIGHT = 300
const WIDTH = 600
const BUFFER = 50

/**
 * The `CollapseConversation` class manages the functionality related to collapsing
 * conversations within the Reason application. It provides methods to check if a user
 * is allowed to save templates based on their license status and to handle the caching
 * of template information.
 */

export class CollapseConversation {
	cache: LocalForage

	constructor(
		public getModel: () => string,
		// public createSourceReasonNodeFile: (
		// 	sourceReasonNode: SourceReasonNode
		// ) => Promise<void>,
		public app: App,
		public aiClient: AIClient,
		public sourceReasonNodeBuilder: BaseReasonNodeBuilder<any>,
		public aggregatorReasonNodeBuilder: BaseReasonNodeBuilder<any>,
		private systemPrompt: string
	) {
		this.cache = localforage.createInstance({
			name: 'reason/template-saver/'
		})
	}

	/**
	 * Collapses a conversation by synthesizing the user prompts and sources from the message history.
	 * It first checks if the user is allowed to save more templates. If not, it aborts the operation.
	 * Otherwise, it proceeds to create a condensed string of user prompts and sources, which is then
	 * used to generate a response from the AI client.
	 *
	 * @param {ChatMessageWithMetadata[]} messageHistory - The history of chat messages with metadata.
	 * @returns {Promise<SynthesisConstruction>} A promise that resolves to a SynthesisConstruction object.
	 */
	async collapse(
		messageHistory: ChatMessageWithMetadata[]
	): Promise<SynthesisConstruction> {
		let messages: ChatCompletionMessage[] = [
			{
				role: 'system',
				content: this.systemPrompt
			}
		]

		const userPrompts = messageHistory
			.filter((msg) => msg.role === 'user' && msg.content.length > 0)
			.map((msg) => (msg.metadata[0] as SynthesisPlanMessageMetadata).prompt)

		const synthesisPlanMetadata = messageHistory
			.filter((msg) => msg.metadata)
			.flatMap((msg) => msg.metadata)
			.filter((metadata) => metadata.assistantMessageType === 'synthesisPlan')
			.flatMap((metadata) => {
				if (metadata.assistantMessageType === 'synthesisPlan') {
					return metadata.sources
				} else {
					return []
				}
			})

		// String together user prompts and print a list of sources
		const messageHistoryCondensed = `Combined user prompts:\n${userPrompts.join(
			'. '
		)}\n\nSources:\n${synthesisPlanMetadata
			.map((m) => JSON.stringify(m))
			.join('\n')}")`

		messages.push({
			role: 'user',
			content: messageHistoryCondensed
		})

		let response
		let openAIResponse = await this.aiClient.createCompletion({
			model: this.getModel(),
			messages: messages
		})
		if ('choices' in openAIResponse) {
			response = openAIResponse.choices[0].message.content.match(/({.*})/s)[0]
		} else {
			throw new Error(
				'Invalid response type: Expected ChatCompletion type with choices.'
			)
		}

		const synthesisConstruction = JSON.parse(
			response as string
		) as SynthesisConstruction

		// Special case if there was just one user prompt; combine and use the single prompt's guidance. But reuse the generated ids; those are valuable
		if (userPrompts.length === 1) {
			return {
				synthesis_constructions: [
					{
						guidance_id:
							synthesisConstruction.synthesis_constructions[0].guidance_id,
						guidance: userPrompts[0],
						source_material: [
							// Take the unique source_materials from the synthesis_constructions
							...new Map(
								synthesisConstruction.synthesis_constructions
									.flatMap((sc) => sc.source_material)
									.map((sm) => [sm.dql, sm])
							).values()
						]
					}
				]
			} as SynthesisConstruction
		}
	}

	/**
	 * Saves the synthesis construction data into a canvas file.
	 * If the canvas file does not exist, it creates a new one with empty data.
	 * If the canvas file exists, it reads the existing data and updates it with the new synthesis construction.
	 * It ensures that the nodes are positioned correctly by calculating the minimum X and Y coordinates.
	 * For each source material in the synthesis construction, it checks if a corresponding node already exists.
	 * If a node exists, it skips the creation; otherwise, it creates a new node for the source material.
	 *
	 * @param {SynthesisConstruction} synthesisConstruction - The synthesis construction data to save.
	 * @param {string} canvasPath - The file path of the canvas where the data should be saved.
	 */
	async save(synthesisConstruction: SynthesisConstruction, canvasPath: string) {
		// TODO handling existing sources / nodes, need to pass the filepath
		let canvasFile = this.app.vault.getAbstractFileByPath(canvasPath) as TFile
		let canvasData: CanvasData
		if (!canvasFile) {
			canvasData = {
				nodes: [],
				edges: []
			} as CanvasData
			// create the file with empty json
			canvasFile = await this.app.vault.create(
				canvasPath,
				JSON.stringify(canvasData)
			)
			return
		} else {
			canvasData = JSON.parse(
				await this.app.vault.cachedRead(canvasFile as TFile)
			) as CanvasData
			if (!canvasData.nodes || !canvasData.edges) {
				canvasData = {
					nodes: [],
					edges: []
				} as CanvasData
			}
		}

		const minX = Math.min(...canvasData.nodes.map((node) => node.x), 0)
		let minY = Math.min(...canvasData.nodes.map((node) => node.y), 0)

		await Promise.all(
			synthesisConstruction.synthesis_constructions.map(
				async (synthesisConstruction) => {
					// Construct SourceReasonNodes for each source_material
					let sourceMaterialFilepaths = await Promise.all(
						synthesisConstruction.source_material.map(
							async (sourceMaterial) => {
								const filepath =
									DEFAULT_BASE_REASON_PATH + '/' + sourceMaterial.id + '.md'

								// Check first whether the node exists
								const existingNode = canvasData.nodes.find(
									(node) => node.file === filepath
								)

								if (existingNode) {
									new Notice(
										`Source material ${sourceMaterial.id} already exists. Skipping.`
									)
									return filepath
								}

								await this.sourceReasonNodeBuilder.createReasonNodeFile(
									{
										role: ReasonNodeType[ReasonNodeType.Source],
										guidance: '',
										dql: sourceMaterial.dql,
										id: sourceMaterial.id
									},
									async (contents: string) => {
										return this.app.vault.create(filepath, contents)
									}
								)

								return filepath
							}
						)
					)
					sourceMaterialFilepaths = sourceMaterialFilepaths.flat()

					// Construct AggregatorReasonNodes for each guidance
					const aggregatorFilepath =
						DEFAULT_BASE_REASON_PATH +
						'/' +
						synthesisConstruction.guidance_id +
						'.md'

					await this.aggregatorReasonNodeBuilder.createReasonNodeFile(
						{
							role: ReasonNodeType[ReasonNodeType.Aggregator],
							guidance: synthesisConstruction.guidance
						},
						async (contents: string) => {
							return this.app.vault.create(aggregatorFilepath, contents)
						}
					)

					// Create file nodes in the canvas for the above

					let sourceNodeIds: string[] = []

					sourceMaterialFilepaths.forEach((filepath, idx) => {
						const id = createHash('sha256')
							.update(filepath)
							.digest('hex')
							.substring(0, 16)

						sourceNodeIds.push(id)

						// Check that the node doesn't already exist
						if (canvasData.nodes.find((node) => node.id === id)) {
							return
						}

						canvasData.nodes.push({
							type: 'file',
							id: id,
							file: filepath,
							x: minX,
							y: minY - (HEIGHT + BUFFER) * (idx + 1),
							width: WIDTH,
							height: HEIGHT
						})
					})

					const aggregatorNodeId = createHash('sha256')
						.update(aggregatorFilepath)
						.digest('hex')
						.substring(0, 16)

					canvasData.nodes.push({
						type: 'file',
						id: aggregatorNodeId,
						file: aggregatorFilepath,
						x: minX + WIDTH + BUFFER * 3,
						y:
							minY -
							Math.round(
								(HEIGHT * sourceMaterialFilepaths.length +
									(BUFFER * sourceMaterialFilepaths.length - 1)) /
									2 +
									HEIGHT / 4 // Centered amidst the source nodes
							),
						width: WIDTH,
						height: Math.round(HEIGHT / 2)
					})

					sourceNodeIds.forEach((sourceNodeId) => {
						canvasData.edges.push({
							id: createHash('sha256')
								.update(sourceNodeId + aggregatorNodeId)
								.digest('hex')
								.substring(0, 16),
							fromNode: sourceNodeId,
							fromSide: 'right',
							toNode: aggregatorNodeId,
							toSide: 'left'
						})
					})

					minY -= (HEIGHT + BUFFER) * sourceMaterialFilepaths.length
				}
			)
		)

		// Write the contents of the canvas back to the file
		await this.app.vault.modify(canvasFile as TFile, JSON.stringify(canvasData))
	}
}
