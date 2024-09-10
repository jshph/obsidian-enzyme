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
import { EditorPosition } from 'obsidian'

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
		const editor = this.app.workspace.activeEditor?.editor
		if (!editor) return []

		const rawContent = editor.getRange(
			{ ch: 0, line: 0 },
			startPos
		)

		const blocks = rawContent.split(/```(enzyme|reason)\n/)
		const messages: ChatMessageWithMetadata[] = []

		for (let i = 1; i < blocks.length; i += 2) {
			const userContent = blocks[i + 1].split('```')[0].trim()
			const assistantContent = blocks[i + 2]?.split(/```(enzyme|reason)\n/)[0].trim() || ''

			const parsedContents = parseEnzymeBlockContents(userContent)

			// If there are no sources, add a default source
			if (parsedContents.sources.length === 0) {
				const processedRawContents =
					this.enzymeBlockConstructor.processRawContents(userContent, i > 1)
				parsedContents.sources = processedRawContents.sources
				parsedContents.prompt = processedRawContents.prompt
			}

			messages.push({
				role: 'user',
				content: userContent,
				metadata: parsedContents
			})

			if (assistantContent) {
				messages.push({
					role: 'assistant',
					content: assistantContent,
					metadata: {}
				})
			}

			// Add the text between enzyme blocks as assistant messages
			if (i + 3 < blocks.length) {
				const textBetweenBlocks = blocks[i + 3].trim()
				if (textBetweenBlocks) {
					messages.push({
						role: 'assistant',
						content: textBetweenBlocks,
						metadata: {}
					})
				}
			}
		}

		// Get the text from the last enzyme block to end of file as last assistant message
		const lastBlockIndex = rawContent.lastIndexOf('```enzyme') !== -1 
			? rawContent.lastIndexOf('```enzyme') 
			: rawContent.lastIndexOf('```reason');
		
		if (lastBlockIndex !== -1) {
			const lastBlockContent = rawContent.slice(lastBlockIndex);
			const lastAssistantContent = lastBlockContent.split('```')[2]?.trim();
			
			if (lastAssistantContent) {
				messages.push({
					role: 'assistant',
					content: lastAssistantContent,
					metadata: {}
				});
			}
		}

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
		return this.digest(messagesToHere, startParams.startPos, true)
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

	async refineDigest(
		prompt: string,
		format: string,
		cursorPos: EditorPosition
	) {
		const editor = this.app.workspace.activeEditor?.editor
		if (!editor) return

		const selection = editor.getSelection()
		const messagesToHere = this.getMessagesToPosition(cursorPos)

    editor.replaceSelection('')

		// treat the selection as a digest, i.e. from the assistant
		const digestMessage: ChatMessageWithMetadata = {
			role: 'assistant',
			content: selection,
			metadata: {}
		}
		messagesToHere.push(digestMessage)

		let refinementPrompt: string

		let optPromptSuffix = `to address the prompt "${prompt}".`
		switch (format) {
			case 'Focus':
				refinementPrompt = `Expand on the previous message ${optPromptSuffix} Add more detail and incorporate additional sources. Preserve existing markers and key points.`
				break
			case 'Style':
				refinementPrompt = `Rewrite the previous message with a style that matches the prompt "${prompt}". Preserve the key points of the previous message and its markers.`
				break
			default:
				refinementPrompt = `Rewrite the previous message ${optPromptSuffix} Incorporate more sources, preserving the key points of the previous message and its markers.`
		}

		const refinementMessage: ChatMessageWithMetadata = {
			role: 'user',
			content: refinementPrompt,
			metadata: undefined
		}
		messagesToHere.push(refinementMessage)

		await this.digest(messagesToHere, cursorPos)
	}
}
