import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	Component,
	EditorPosition,
	Editor,
	EditorRange
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
	observerMap: Map<string, MutationObserver>
	intersectionObserverMap: Map<string, IntersectionObserver>
	hiddenEnzymeBlocks: Set<string>
	enzymeProcessor: any
	reasonProcessor: any

	constructor(
		public app: App,
		public enzymeAgent: ObsidianEnzymeAgent,
		public candidateRetriever: DataviewCandidateRetriever,
		public dataviewGraphLinker: DataviewGraphLinker,
    public getModels: () => string[],
    public setModel: (label: string) => void
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
		const container = el.createEl('div', { cls: 'enzyme-container' })
		const uniqueId = 'enzyme-' + Math.random().toString(36).substr(2, 9)
		el.setAttribute('data-unique-id', uniqueId)

		// Create the digest button
		if (doRenderButton) {
			this.createDigestButton(container, el, context, executionLock)
		}

		// Create the sources button
		if (sources.length > 0) {
			this.createSourcesButton(container, sources)
		}

    this.createModelSelectButton(container)

		// Render the content
		MarkdownRenderer.render(this.app, content, container, '/', new Component())

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
	}

  createModelSelectButton(container: HTMLElement) {
    const selectEl = container.createEl('div', { cls: 'enzyme-model-select-wrapper' });
    const selectWrapper = selectEl.createEl('div')
    selectWrapper.style.position = 'relative'

    const arrow = selectWrapper.createEl('span', { cls: 'enzyme-model-select-arrow' });
    arrow.setText('▼');

    const modelSelect = selectWrapper.createEl('select', {
        cls: 'enzyme-model-select'
    });

    this.getModels().forEach(
        (label) => {
            const option = modelSelect.createEl('option', {
                text: label,
                value: label
            });

            modelSelect.appendChild(option)
        }
    )

    modelSelect.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
            this.setModel(event.target.value);
            arrow.setText('▼'); // Always show down arrow
        }
    });

    container.appendChild(selectWrapper);
  }

	createDigestButton(
		container: HTMLElement,
		el: HTMLElement,
		context: MarkdownPostProcessorContext,
		executionLock: { isExecuting: boolean }
	) {
		const button = container.createEl('button', {
			cls: 'enzyme-digest-button',
			text: 'Digest'
		})
		button.addEventListener('click', async () => {
			await this.handleDigestButtonClick(el, context, executionLock)
		})
	}

	createSourcesButton(container: HTMLElement, sources: StrategyMetadata[]) {
		const button = container.createEl('button', {
			cls: 'enzyme-sources-button',
			text: 'Sources'
		})
		const sourcesContent = document.body.createEl('div', {
			cls: 'enzyme-sources-content'
		})

		sources.forEach(async (source) => {
			const sourceBlock =
				await this.candidateRetriever.obsidianContentRenderer.extractor.renderSourceBlock(
					source
				)
			const sourceEl = sourcesContent.createEl('div', { cls: 'enzyme-source' })
			MarkdownRenderer.render(
				this.app,
				sourceBlock,
				sourceEl,
				'/',
				new Component()
			)
		})

		button.addEventListener('click', (event) => {
			event.stopPropagation()
			const rect = button.getBoundingClientRect()
			sourcesContent.style.top = `${rect.bottom + window.scrollY + 5}px`
			sourcesContent.style.left = `${rect.left + window.scrollX}px`
			sourcesContent.classList.toggle('show')
		})

		// Close the sources content when clicking outside
		document.addEventListener('click', () => {
			sourcesContent.classList.remove('show')
		})

		sourcesContent.addEventListener('click', (event) => {
			event.stopPropagation()
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
		let sources: StrategyMetadata[] = []
		const executionLock = { isExecuting: false }
		let editor = this.app.workspace.activeEditor?.editor
		let dropdownId = ''

		if (blockContents.trim().length === 0) {
			// Handle empty codefence
			renderedString = 'Enzyme block is missing a prompt...'
			this.renderIntoEl(
				el,
				renderedString,
				sources,
				context,
				executionLock,
				true
			)
			return
		}

		let parsedContents = parseEnzymeBlockContents(blockContents)

		// Extract sources and generate markdown sections
		sources = parsedContents.sources
		let prompt = parsedContents.prompt

		const messagesSoFar = this.enzymeAgent.getMessagesToPosition({
			line: context.getSectionInfo(el)?.lineEnd + 1,
			ch: 0
		})

		// Handle empty sources
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

		let selectedStrategy: string | undefined
		if (parsedContents.choice) {
			selectedStrategy = parsedContents.choice.strategy
		} else if (sources.length === 0 && messagesSoFar.length == 1) {
			// Default to RecentMentions if no sources are provided and this is the first message
			selectedStrategy = DQLStrategy.RecentMentions.toString()
		}

		// Render the strategy dropdown if a strategy is selected
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

			renderedString += `Update the source: ${dropdownHtml}\n`
		}

		// Only render the prompt, not the sources
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

	trimHighlightedContent(editor: Editor) {
		const cursor = editor.getCursor()
		const file = this.app.workspace.getActiveFile()
		if (!file) return

		const fileContents = editor.getValue()
		const lines = fileContents.split('\n')

		// Check for frontmatter
		let frontmatterOffset = 0
		if (lines[0] === '---') {
			for (let i = 1; i < lines.length; i++) {
				if (lines[i] === '---') {
					frontmatterOffset = i + 1
					break
				}
			}
		}

		let startLine = cursor.line
		let endLine = cursor.line

		// Find the previous Enzyme block
		while (
			startLine > frontmatterOffset &&
			!lines[startLine].startsWith('```enzyme')
		) {
			startLine--
		}
		let enzymeBlockEnd = startLine
		while (
			enzymeBlockEnd < lines.length - 1 &&
			!(lines[enzymeBlockEnd].startsWith('```') && enzymeBlockEnd > startLine)
		) {
			enzymeBlockEnd++
		}
		startLine = enzymeBlockEnd + 1 // Start after the enzyme block

		// Find the end of the digest output
		while (
			endLine < lines.length - 1 &&
			!lines[endLine].startsWith('```enzyme')
		) {
			endLine++
		}
		endLine-- // Move to the line before the next enzyme block or end of file

		let keptContent = []
		let isHighlighted = false

		for (let i = startLine; i <= endLine; i++) {
			const line = lines[i]
			if (line.includes('==')) {
				isHighlighted = !isHighlighted
				const trimmedLine = line.replace(/==/g, '').trim()
				if (trimmedLine) keptContent.push(trimmedLine)
			} else if (isHighlighted) {
				keptContent.push(line.trim())
			}
		}

		const newContent = keptContent.join('\n\n')

		// Find the next enzyme block or end of file
		let nextEnzymeBlock = endLine + 1
		while (
			nextEnzymeBlock < lines.length &&
			!lines[nextEnzymeBlock].startsWith('```enzyme')
		) {
			nextEnzymeBlock++
		}

		// Replace the content after the enzyme block, accounting for frontmatter
		editor.replaceRange(
			newContent + (nextEnzymeBlock < lines.length ? '\n' : ''),
			{ line: startLine, ch: 0 },
			{ line: nextEnzymeBlock - 1, ch: lines[nextEnzymeBlock - 1].length }
		)
	}
}
