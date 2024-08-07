import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	Component,
	EditorPosition
} from 'obsidian'
import {
	ObsidianEnzymeAgent,
	StrategyMetadata
} from '../notebook/ObsidianEnzymeAgent'
import { Notice } from 'obsidian'
import { DQLStrategy, SELECTABLE_STRATEGIES } from '../source/extract/Strategy'
import dedent from 'dedent-js'
import { DataviewCandidateRetriever } from '../source/retrieve'
import { DataviewGraphLinker } from './DataviewGraphLinker'
import { parseEnzymeBlockContents } from './EnzymeBlockConstructor'

let dropdownChangeListener: (event: Event) => void

/**
 * This class is responsible for rendering custom code blocks within Obsidian markdown files.
 * It registers a markdown code block processor for the 'enzyme' code block type and defines
 * the rendering logic for these blocks. The class interacts with various components of the
 * Enzyme plugin, such as EnzymeAgent, and the markdown code block processor
 * registration function, to facilitate the rendering of 'enzyme' blocks with interactive
 * elements and integration with the enzymeing engine.
 */
export class CodeBlockRenderer {
	enzymeResponseContainer: HTMLElement
	observerMap: Map<string, MutationObserver>
	intersectionObserverMap: Map<string, IntersectionObserver>
	hiddenEnzymeBlocks: Set<string>
	enzymeProcessor: any
	reasonProcessor: any

	constructor(
		public app: App,
		public enzymeAgent: ObsidianEnzymeAgent,
		public candidateRetriever: DataviewCandidateRetriever,
		public dataviewGraphLinker: DataviewGraphLinker
	) {
		this.observerMap = new Map()
		this.intersectionObserverMap = new Map()
		this.hiddenEnzymeBlocks = new Set()
	}

	renderIntoEl(
		el: HTMLElement,
		content: string,
		sources: StrategyMetadata[],
		context: MarkdownPostProcessorContext,
		executionLock: { isExecuting: boolean },
		doRenderButton: boolean = true
	) {
		el.setText('')
		const container = el.createEl('div')
		const body = container.createDiv('enzyme-preview')
		const s = body.createSpan()
		const uniqueId = 'enzyme-' + Math.random().toString(36).substr(2, 9)
		el.setAttribute('data-unique-id', uniqueId)

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					mutation.removedNodes.forEach((node) => {
						if (
							node.nodeType === Node.ELEMENT_NODE &&
							node.childNodes[0]?.nodeType === Node.ELEMENT_NODE &&
							(node.childNodes[0] as HTMLElement).getAttribute(
								'data-unique-id'
							) === uniqueId &&
							!this.hiddenEnzymeBlocks.has(uniqueId)
						) {
							// Main action: remove sources
							this.dataviewGraphLinker.removeSources(sources)

							// Cleanup
							observer.disconnect()
							this.observerMap.delete(uniqueId)
							const intersectionObserver =
								this.intersectionObserverMap.get(uniqueId)
							if (intersectionObserver) {
								intersectionObserver.disconnect()
								this.intersectionObserverMap.delete(uniqueId)
							}
						}
					})
				}
			}
		})

		this.observerMap.set(uniqueId, observer)
		observer.observe(el.parentElement.parentElement, {
			childList: true
		})

		// Temporarily store hidden blocks to avoid "removing sources" if they're not really removed
		const intersectionObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) {
					this.hiddenEnzymeBlocks.add(uniqueId)
				} else {
					this.hiddenEnzymeBlocks.delete(uniqueId)
				}
			})
		})

		this.intersectionObserverMap.set(uniqueId, intersectionObserver)
		intersectionObserver.observe(el)

		MarkdownRenderer.render(this.app, content, s, '/', new Component())

		if (doRenderButton) {
			this.createDigestButton(body, el, context, executionLock)
		}
	}

	createDigestButton(
		body: HTMLElement,
		el: HTMLElement,
		context: MarkdownPostProcessorContext,
		executionLock: { isExecuting: boolean }
	) {
		const button = body.createEl('button')
		button.addClass('enzyme-generate-button')
		button.setText('Digest')
		button.addEventListener('click', async () => {
			await this.handleDigestButtonClick(el, context, executionLock)
		})
	}

	async handleDigestButtonClick(
		el: HTMLElement,
		context: MarkdownPostProcessorContext,
		executionLock: { isExecuting: boolean }
	) {
		if (!this.enzymeAgent.checkSetup()) {
			new Notice(
				'Please check that Enzyme is set up properly (i.e. API Key, etc.)'
			)
			return
		}

		if (!executionLock.isExecuting) {
			try {
				executionLock.isExecuting = true
				const digestStartPos = this.getDigestStartLine(el, context)
				await this.enzymeAgent.buildMessagesAndDigest({
					startPos: digestStartPos
				})
			} catch (e) {
				new Notice('Enzyme encountered an error: ' + e.message)
			} finally {
				executionLock.isExecuting = false
			}
		} else {
			new Notice('Please wait for Enzyme to finish.')
		}
	}

	/* Renders the 'enzyme' code block in the markdown preview.
	 *
	 * This function is responsible for parsing the contents of a 'enzyme' code block,
	 * creating the necessary HTML elements to display the block within the markdown preview,
	 * and setting up the interaction logic for the 'Send' button which triggers the enzymeing process.
	 *
	 * @param {string} blockContents - The raw text content of the 'enzyme' code block.
	 * @param {HTMLElement} el - The parent HTML element where the 'enzyme' block will be rendered.
	 * @param {MarkdownPostProcessorContext} context - The context provided by Obsidian for post-processing the markdown.
	 */
	async renderEnzyme(
		blockContents: string,
		el: HTMLElement,
		context: MarkdownPostProcessorContext
	) {
		if (!this.app.workspace.activeEditor) {
			return
		}

		let renderedString: string = ''
		let sources: StrategyMetadata[]
		const executionLock = { isExecuting: false }
		let editor = this.app.workspace.activeEditor.editor
		let dropdownId = ''
		if (blockContents.length > 0) {
			let parsedContents = parseEnzymeBlockContents(blockContents)

			// Extract sources and generate markdown sections
			sources = parsedContents.sources
			let prompt = parsedContents.prompt

			const messagesSoFar = this.enzymeAgent.getMessagesToPosition({
				line: context.getSectionInfo(el).lineEnd + 1,
				ch: 0
			})

			// Default to RecentMentions if no sources are provided and this is the first message
			// need to do this fudging in order to render it properly, but it's not needed for all uses of parseEnzymeBlockContents
			if (sources.length === 0) {
				const processedContents =
					this.enzymeAgent.enzymeBlockConstructor.processRawContents(
						blockContents,
						messagesSoFar.length > 1
					)
				sources = processedContents.sources
				prompt = processedContents.prompt
			} else if (sources.length === 1 && !sources[0].strategy) {
				sources[0].strategy = DQLStrategy[DQLStrategy.Basic]
			}

			let selectedStrategy: string = undefined
			if (parsedContents.choice) {
				selectedStrategy = parsedContents.choice.strategy
			} else if (sources.length === 0 && messagesSoFar.length == 1) {
				// Default to RecentMentions if no sources are provided
				selectedStrategy = DQLStrategy.RecentMentions.toString()
			}

			// Render the collapsible header and the dropdown
			if (selectedStrategy) {
				dropdownId = 'enzyme-choice-' + Math.random().toString(36).substr(2, 9)
				const strategiesHTML = SELECTABLE_STRATEGIES.map((strategy) => {
					const strategyStr = strategy.toString()
					return `<option value="${strategyStr}" ${strategyStr === selectedStrategy ? 'selected' : ''}>${strategyStr}</option>`
				})

				const dropdownHtml =
					`<select id="${dropdownId}">${strategiesHTML.join('')}</select>`.replace(
						/^\s+/gm,
						''
					)

				renderedString += `> [!Source ${selectedStrategy}]-\n> Update the source: ${dropdownHtml}\n> `
			} else if (sources.length > 0) {
				renderedString += '> [!Sources]-\n> '
			}

			// Render the sources
			if (selectedStrategy) {
				let sourceString =
					await this.candidateRetriever.obsidianContentRenderer.extractor.renderSourceBlock(
						{ strategy: selectedStrategy }
					)

				sourceString = sourceString.split('\n').join('\n> ')

				// Encase sources as collapsible Markdown block
				renderedString += sourceString + '\n\n'
			} else if (sources.length > 0) {
				const sourceStringParts = (
					await Promise.all(
						sources.map(async (source) =>
							this.candidateRetriever.obsidianContentRenderer.extractor.renderSourceBlock(
								source
							)
						)
					)
				).flat()

				// Encase sources as collapsible Markdown block
				renderedString +=
					sourceStringParts.join('\n\n---\n').split('\n').join('\n> ') + '\n\n'
			}

			renderedString += prompt

			await this.dataviewGraphLinker.addSources(sources)

			this.renderIntoEl(el, renderedString, sources, context, executionLock)

			// Attach event listener after rendering to allow user to change the dropdown and update the choice
			if (dropdownId.length > 0) {
				setTimeout(() => {
					const dropdown = document.getElementById(dropdownId)
					dropdownChangeListener = (event) => {
						// Case preserving strategy selection
						const selectedStrategy = (event.target as HTMLSelectElement).value

						editor.setLine(
							parsedContents.choice.line +
								context.getSectionInfo(el).lineStart +
								1,
							'choice: ' + selectedStrategy
						)

						blockContents = blockContents.replace(
							/choice: [a-zA-Z]+/,
							`choice: ${selectedStrategy}`
						)

						this.renderEnzyme(blockContents, el, context)
					}
					if (dropdown) {
						dropdown.addEventListener('change', dropdownChangeListener)
					}
				}, 100) // hacky way to ensure that the dropdown is rendered before we attach the event listener
			}
		} else {
			renderedString += 'Invalid Enzyme block! 🫤'
			this.renderIntoEl(
				el,
				renderedString,
				sources,
				context,
				executionLock,
				false
			)
		}
	}

	buildEnzymeBlockFromCurLine() {
		const editor = this.app.workspace.activeEditor.editor

		// Replace contents from beginning of selection to end of selection with the new block
		const cursor = editor.getCursor()
		const selectedText = editor.getLine(cursor.line)

		editor.replaceRange(
			dedent`
      \`\`\`enzyme
      ${selectedText}
      \`\`\`
      `.trim() + '\n',
			{
				line: cursor.line,
				ch: 0
			},
			{
				line: cursor.line,
				ch: selectedText.length
			}
		)
	}

	getDigestStartLine(
		el: HTMLElement,
		context: MarkdownPostProcessorContext
	): EditorPosition {
		let endOfCodeFenceLine = context.getSectionInfo(el).lineEnd
		let editor = this.app.workspace.activeEditor.editor

		// Find the first non-empty line after the code fence
		let curLine = endOfCodeFenceLine + 1
		while (
			curLine < editor.lineCount() &&
			editor.getLine(curLine).trim() === ''
		) {
			curLine++
		}

		if (curLine >= editor.lineCount()) {
			curLine = endOfCodeFenceLine + 1
		}

		// Process any existing markdown highlights immediately following the code block
		while (
			curLine < editor.lineCount() &&
			(editor.getLine(curLine).includes('==') ||
				editor.getLine(curLine).trim() === '')
		) {
			let lineText = editor.getLine(curLine)
			// If the line contains markdown highlights, skip to the end of the highlight
			if (lineText.includes('==')) {
				curLine++
				while (
					curLine < editor.lineCount() &&
					!editor.getLine(curLine).includes('==')
				) {
					curLine++
				}
			}
			curLine++
		}

		if (curLine >= editor.lineCount()) {
			curLine--
		}

		// Set the cursor position for the new synthesis container
		let curCh = 0 // Start from the beginning of the line

		return { line: curLine + 1, ch: curCh }
	}
}
