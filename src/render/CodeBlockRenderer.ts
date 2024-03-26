import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	Component
} from 'obsidian'
import { DataviewSource, ReasonAgent } from '../notebook/ReasonAgent'
import { SynthesisContainer } from './SynthesisContainer'
import { getAggregatorMetadata } from '../notebook/RankedSourceBuilder'
import { CanvasLoader } from '../notebook/CanvasLoader'
import * as yaml from 'yaml'
import { Notice } from 'obsidian'
import { DQLStrategyDescriptions } from 'reason-node/SourceReasonNodeBuilder'

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
		public registerMarkdownCodeBlockProcessor: any
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
	 * and setting up the interaction logic for the 'Generate' button which triggers the reasoning process.
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
		let { type, ...parsedContents } =
			this.parseReasonBlockContents(blockContents)

		const button = body.createEl('button')
		button.addClass('reason-generate-button')

		let renderedString: string
		let sources: DataviewSource[]
		let prompt: string
		const executionLock = { isExecuting: false }
		if (blockContents.length > 0) {
			let sourceStringParts: string[] = []
			prompt = (parsedContents as any).prompt

			// Handle different types of code blocks: aggregator, source, and plaintext
			if (type === 'source' || type === 'aggregator') {
				// For 'source' and 'aggregator' types, extract sources and generate markdown sections
				sources = (parsedContents as any).sources
				sourceStringParts = sources.map((source) => {
					// If a DQL query is present, format it as a code block
					const dqlPart = source.dql
						? `\`\`\`dataview\n${source.dql}\n\`\`\`\n`
						: ''
					// If a strategy is specified (only for 'source' type), add a description
					const strategyPart =
						type === 'source' &&
						source.strategy &&
						DQLStrategyDescriptions[source.strategy] !== undefined
							? `**Strategy**: ${DQLStrategyDescriptions[source.strategy]}\n`
							: ''
					return `### Source:\n${dqlPart}${strategyPart}`
				})
			} else {
				// For plaintext blocks, simply use the block contents as the rendered string
				renderedString = blockContents
			}

			// If a prompt is provided, format it as a blockquote section
			const guidanceString = prompt
				? `\n---\n### Guidance:\n> ${prompt.split('\n').join('\n> ')}`
				: ''
			// Combine the source sections and guidance string to form the final rendered string
			renderedString = sourceStringParts.join('\n\n') + guidanceString

			MarkdownRenderer.render(this.app, renderedString, s, '/', new Component())

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
						if (sources?.length > 0) {
							await this.reasonAgent.synthesize(synthesisContainerEl)
						} else {
							await this.reasonAgent.execute(synthesisContainerEl)
						}
					}
				)
			})
		} else {
			button.setText('Continue')
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
					async (synthesisContainerEl) =>
						await this.reasonAgent.synthesize(synthesisContainerEl)
				)
			})

			// check if there are messages before this code block
			const tempSynthesisContainer = new SynthesisContainer(
				this.app.workspace.activeEditor.editor,
				context.getSectionInfo(el).lineEnd,
				0,
				context.getSectionInfo(el).lineEnd,
				this
			)

			if (tempSynthesisContainer.getMessagesToHere().length > 0) {
				const saveButton = body.createEl('button')
				saveButton.addClass('reason-generate-button')
				saveButton.setText('Save')
				saveButton.addEventListener('click', async () => {
					this.createSynthesisContainerAction(
						el,
						context,
						executionLock,
						async (synthesisContainerEl) =>
							await this.reasonAgent.collapseAndPersist(synthesisContainerEl)
					)
				})
			}
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
		const endOfCodeFenceLine = context.getSectionInfo(codeblockEl).lineEnd
		let editor = this.app.workspace.activeEditor.editor
		editor.replaceRange('\n> [!💭]+\n> ', {
			ch: 0,
			line: endOfCodeFenceLine + 1
		})

		let curLine = endOfCodeFenceLine + 3
		let curCh = 2

		return new SynthesisContainer(
			editor,
			curLine,
			curCh,
			endOfCodeFenceLine,
			this
		)
	}

	/**
	 * Parses the contents of a Reason code block as YAML, producing either an Aggregator or contents to produce
	 *
	 * @param contents the raw contents, which we'll try to parse as valid YAML syntax. Otherwise, it will be interpreted as plaintext, i.e. to rank existing sources in the canvas.
	 * @returns metadata, i.e. Aggregator metadata
	 */
	parseReasonBlockContents(
		contents: string
	):
		| AggregatorReasonBlockContents
		| SourceReasonBlockContents
		| PlainTextReasonBlockContents {
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
						dql: source.dql,
						strategy: source.strategy,
						evergreen: source.evergreen
					} as DataviewSource
				})
				prompt = parsedYaml.guidance
				return {
					type: 'source',
					prompt,
					sources
				}
			} else {
				return {
					type: 'plaintext',
					prompt: contents
				} as PlainTextReasonBlockContents
			}
		} catch (e) {
			// it wasn't yaml, just a plaintext prompt
			return {
				type: 'plaintext',
				prompt: contents
			} as PlainTextReasonBlockContents
		}
	}
}
