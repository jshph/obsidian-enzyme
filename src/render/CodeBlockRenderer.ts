import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	Component
} from 'obsidian'
import {
	DataviewSource,
	ReasonAgent,
	StrategyMetadata
} from '../notebook/ReasonAgent'
import { SynthesisContainer } from './SynthesisContainer'
import { getAggregatorMetadata } from '../notebook/RankedSourceBuilder'
import { CanvasLoader } from '../notebook/CanvasLoader'
import * as yaml from 'yaml'
import { Notice } from 'obsidian'
import { DQLStrategy } from 'reason-node/SourceReasonNodeBuilder'
import { DataviewCandidateRetriever } from 'source/retrieve'

type ReasonBlockContents = {
	prompt: string
	sources: DataviewSource[]
}

export type AggregatorReasonBlockContents = {
	type: 'aggregator'
	aggregatorId?: string
} & ReasonBlockContents

export type SourceReasonBlockContents = {
	type: 'source'
} & ReasonBlockContents

export type PlainTextReasonBlockContents = {
	type: 'plaintext'
	prompt: string
}

/**
 * This class is responsible for rendering custom code blocks within Obsidian markdown files.
 * It registers a markdown code block processor for the 'reason' code block type and defines
 * the rendering logic for these blocks. The class interacts with various components of the
 * Reason plugin, such as the CanvasLoader, ReasonAgent, and the markdown code block processor
 * registration function, to facilitate the rendering of 'reason' blocks with interactive
 * elements and integration with the reasoning engine.
 */
export class CodeBlockRenderer {
	reasonResponseContainer: HTMLElement

	constructor(
		public app: App,
		public canvasLoader: CanvasLoader,
		public reasonAgent: ReasonAgent,
		public registerMarkdownCodeBlockProcessor: any,
		public candidateRetriever: DataviewCandidateRetriever
	) {
		this.registerMarkdownCodeBlockProcessor(
			'reason',
			this.renderReason.bind(this)
		)
	}

	/**
	 * Renders the 'reason' code block in the markdown preview.
	 *
	 * This function is responsible for parsing the contents of a 'reason' code block,
	 * creating the necessary HTML elements to display the block within the markdown preview,
	 * and setting up the interaction logic for the 'Send' button which triggers the reasoning process.
	 *
	 * @param {string} blockContents - The raw text content of the 'reason' code block.
	 * @param {HTMLElement} el - The parent HTML element where the 'reason' block will be rendered.
	 * @param {MarkdownPostProcessorContext} context - The context provided by Obsidian for post-processing the markdown.
	 */
	async renderReason(
		blockContents: string,
		el: HTMLElement,
		context: MarkdownPostProcessorContext
	) {
		const container = el.createEl('div')

		const body = container.createDiv('reason-preview')
		const s = body.createSpan()

		await this.canvasLoader.reload()

		// check if there are messages before this code block
		const tempSynthesisContainer = new SynthesisContainer(
			this.app.workspace.activeEditor.editor,
			context.getSectionInfo(el).lineStart,
			0,
			context.getSectionInfo(el).lineEnd + 1,
			this
		)

		let renderedString: string = ''
		let sources: DataviewSource[]
		let prompt: string
		const executionLock = { isExecuting: false }

		if (blockContents.length > 0) {
			let { type, ...parsedContents } =
				this.parseReasonBlockContents(blockContents)

			let sourceStringParts: string[] = []
			prompt = (
				parsedContents as
					| AggregatorReasonBlockContents
					| SourceReasonBlockContents
			).prompt

			// Handle different types of code blocks: aggregator, source, and plaintext
			if (type === 'source' || type === 'aggregator') {
				// For 'source' and 'aggregator' types, extract sources and generate markdown sections
				sources = (
					parsedContents as
						| AggregatorReasonBlockContents
						| SourceReasonBlockContents
				).sources

				// Default to RecentMentions if no sources are provided and this is the first message
				if (
					sources.length === 0 &&
					tempSynthesisContainer.getMessagesToHere().length === 1
				) {
					sources.push({
						strategy: { name: DQLStrategy[DQLStrategy.RecentMentions] }
					})
				}

				if (sources.length > 0) {
					sourceStringParts = (
						await Promise.all(
							sources.map(async (source) =>
								this.candidateRetriever.contentRenderer.extractor.renderSourceBlock(
									source.strategy,
									source.sourcePreamble
								)
							)
						)
					).flat()

					// Encase sources as collapsible Markdown block
					renderedString =
						'> [!Sources]-\n> ' +
						sourceStringParts.join('\n\n').split('\n').join('\n> ') +
						'\n\n'
				}
			}

			renderedString += prompt

			MarkdownRenderer.render(this.app, renderedString, s, '/', new Component())

			const button = body.createEl('button')
			button.addClass('reason-generate-button')
			button.setText('Send')
			button.addEventListener('click', async () => {
				if (!this.reasonAgent.checkSetup()) {
					new Notice(
						'Please check that Reason is set up properly (i.e. API Key, etc.)'
					)
					return
				}
				this.createSynthesisContainerAction(
					el,
					context,
					executionLock,
					async (synthesisContainerEl) => {
						await this.reasonAgent.synthesize(synthesisContainerEl)
					}
				)
			})
		} else {
			renderedString += 'Invalid Reason block! 🫤'
			MarkdownRenderer.render(this.app, renderedString, s, '/', new Component())
		}
	}

	/**
	 * Creates a synthesis container and performs the provided action on it.
	 * This function is designed to be called when a user interaction requires
	 * a synthesis container to be created and an action to be executed with it.
	 * The action is an asynchronous callback that receives the created synthesis
	 * container as an argument. The execution of the action is guarded by an
	 * execution lock to prevent concurrent executions.
	 *
	 * @param el - The HTML element where the synthesis container will be attached.
	 * @param context - The context in which the synthesis container is being created.
	 * @param executionLock - An object with an 'isExecuting' property that indicates
	 *                        if an action is currently being executed.
	 * @param callback - The asynchronous function to be executed with the created
	 *                   synthesis container. It must return a Promise.
	 */
	async createSynthesisContainerAction(
		el: HTMLElement,
		context,
		executionLock: { isExecuting: boolean },
		callback: (synthesisContainerEl: SynthesisContainer) => Promise<void>
	) {
		if (!executionLock.isExecuting) {
			try {
				executionLock.isExecuting = true
				const synthesisContainerEl = this.createSynthesisContainer(el, context)
				await callback(synthesisContainerEl)
			} catch (e) {
				new Notice('Reason encountered an error: ' + e.message)
			} finally {
				executionLock.isExecuting = false
			}
		} else {
			new Notice('Please wait for Reason to finish.')
		}
	}

	createSynthesisContainer(
		codeblockEl: HTMLElement,
		context: MarkdownPostProcessorContext
	): SynthesisContainer {
		let endOfCodeFenceLine = context.getSectionInfo(codeblockEl).lineEnd
		let editor = this.app.workspace.activeEditor.editor
		editor.replaceRange('\n> [!💭]+\n> ', {
			ch: 0,
			line: endOfCodeFenceLine + 1
		})

		let curLine = endOfCodeFenceLine + 3
		endOfCodeFenceLine += 3
		let curCh = 2

		return new SynthesisContainer(
			editor,
			curLine,
			curCh,
			endOfCodeFenceLine + 1,
			this
		)
	}

	/**
	 * Parses the contents of a Reason code block as YAML, producing an Aggregator (with guidance + sources, or by ID)
	 *
	 * @param contents the raw contents, which we'll try to parse as valid YAML syntax.
	 * @returns metadata, i.e. Aggregator metadata
	 */
	parseReasonBlockContents(
		contents: string
	): AggregatorReasonBlockContents | SourceReasonBlockContents {
		let prompt
		let sources

		try {
			const parsedYaml = yaml.parse(contents.replace(/\t/g, '    '))
			if (parsedYaml?.aggregator) {
				const aggregatorId = parsedYaml.aggregator
				let metadata = getAggregatorMetadata(
					aggregatorId,
					this.canvasLoader.canvasData,
					this.app
				)
				return {
					type: 'aggregator',
					aggregatorId: metadata.aggregatorId,
					sources: metadata.sources,
					prompt: metadata.prompt
				} as AggregatorReasonBlockContents
			} else if (parsedYaml?.sources?.length > 0) {
				sources = parsedYaml.sources.map((source) => {
					return {
						strategy: { ...source.strategy } as StrategyMetadata,
						sourcePreamble: source.sourcePreamble
					} as DataviewSource
				})
				prompt = parsedYaml.guidance
				return {
					type: 'source',
					prompt,
					sources
				}
			} else if (parsedYaml?.guidance) {
				return {
					type: 'source',
					prompt: parsedYaml.guidance,
					sources: []
				}
			} else {
				return {
					type: 'source',
					prompt: contents,
					sources: []
				}
			}
		} catch (e) {
			// By default return empty sources. Currently the caller sets this to RecentMentions; needs to be differentiated from valid YAML
			return {
				type: 'source',
				prompt: contents,
				sources: []
			}
		}
	}
}
