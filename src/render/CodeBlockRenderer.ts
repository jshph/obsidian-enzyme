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
import { renderCodeBlockRenderer } from './EnzymeBlock'

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
		public getModels: () => Promise<string[]>,
		public getSelectedModel: () => string,
		public setModel: (label: string) => void,
		public exclusionPatterns: string[]
	) {
		this.observerMap = new Map()
		this.intersectionObserverMap = new Map()
		this.hiddenEnzymeBlocks = new Set()
	}

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

	renderIntoEl(
		el: HTMLElement,
		content: string,
		sources: StrategyMetadata[],
		context: MarkdownPostProcessorContext,
		executionLock: { isExecuting: boolean },
		doRenderButton: boolean = true
	) {
		renderCodeBlockRenderer(el, {
			app: this.app,
			enzymeAgent: this.enzymeAgent,
			candidateRetriever: this.candidateRetriever,
			dataviewGraphLinker: this.dataviewGraphLinker,
			getModels: this.getModels,
			getSelectedModel: this.getSelectedModel,
			setModel: this.setModel,
			content,
			sources,
			context
		})
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
