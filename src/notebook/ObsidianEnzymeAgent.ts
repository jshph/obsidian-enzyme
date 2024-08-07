import { CandidateRetriever, AIClient, EnzymeAgent } from 'enzyme-core'
import { ObsidianWriter } from '../render/ObsidianWriter'
import {
	BlockRefSubstitution,
	ChatMessageWithMetadata,
	SystemPrompts
} from 'enzyme-core'
import { App, EditorPosition, Notice } from 'obsidian'
import {
	EnzymeBlockConstructor,
	parseEnzymeBlockContents
} from '../render/EnzymeBlockConstructor'

export type StrategyMetadata = {
	strategy: string
	dql?: string
	id?: string
	sourcePreamble?: string // Optional -- a preamble to be included about the source
	evergreen?: string
	folder?: string
}

/**
 * The `ObsidianEnzymeAgent` class is a central component of the Enzyme plugin, responsible for orchestrating
 * the enzymeing process within Obsidian. It manages the interaction between different enzymeing
 * systems and the user interface, providing methods to synthesize content
 */
export class ObsidianEnzymeAgent extends EnzymeAgent {
	constructor(
		public app: App,
		public aiClient: AIClient,
		public enzymeBlockConstructor: EnzymeBlockConstructor,
		public candidateRetriever: CandidateRetriever,
		public getModel: () => string,
		public checkSetup: () => boolean,
		protected systemPrompts: SystemPrompts
	) {
		super(
			aiClient,
			candidateRetriever,
			getModel,
			systemPrompts,
			(writerParams) =>
				new ObsidianWriter({
					curPos: writerParams,
					editor: this.app.workspace.activeEditor.editor
				})
		)
	}

	getMessagesToPosition(startPos: EditorPosition): ChatMessageWithMetadata[] {
		const rawContent = this.app.workspace.activeEditor.editor.getRange(
			{ ch: 0, line: 0 },
			startPos
		)

		const combinedBlocks = rawContent.match(
			/```(enzyme|reason)\n([\s\S]*?)\n```|==([\s\S]*?)==/g
		)
		const messages = combinedBlocks.map((block, index) => {
			const role =
				block.includes('```enzyme\n') || block.includes('```reason\n')
					? 'user'
					: 'assistant'

			let displayedContent =
				role === 'user'
					? block.match(/```(enzyme|reason)\n([\s\S]*?)\n```/)[2]
					: block.match(/==([\s\S]*?)==/)[1]
			let content = displayedContent
			let parsedContents
			// Further process if the user message contains more than just a prompt
			if (role === 'user') {
				parsedContents = parseEnzymeBlockContents(displayedContent)

				// If there are no sources, add a default source
				if (parsedContents.sources.length === 0) {
					const processedRawContents =
						this.enzymeBlockConstructor.processRawContents(
							displayedContent,
							index > 0
						)
					parsedContents.sources = processedRawContents.sources

					parsedContents.prompt = processedRawContents.prompt
				}
			}

			return {
				role,
				content,
				metadata: parsedContents
			} as ChatMessageWithMetadata
		})

		return messages
	}

	/**
	 * Produces a synthesized response to the user's input, based on the context of the conversation.
	 *
	 * @param {EditorPosition} startPos - The position in the editor where the synthesis process should start.
	 * @returns {Promise<void>} - A promise that resolves when the synthesis process is complete.
	 */
	buildMessagesAndDigest(startParams: {
		startPos: EditorPosition
	}): Promise<void> {
		const messagesToHere: ChatMessageWithMetadata[] =
			this.getMessagesToPosition(startParams.startPos)
		return this.digest(messagesToHere, startParams.startPos)
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
	substituteBlockEmbeds(contents: string): {
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

	digestContentNotice(): void {
		new Notice('Digesting content...')
	}
}
