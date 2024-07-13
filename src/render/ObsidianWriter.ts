import { Editor, EditorPosition } from 'obsidian'
import { BaseWriter } from 'enzyme-core'

export class ObsidianWriter extends BaseWriter {
	curPos: EditorPosition
	editor: Editor

	// Writes from a position
	constructor(writerParams: { curPos: EditorPosition; editor: Editor }) {
		super()
		this.curPos = writerParams.curPos
		this.editor = writerParams.editor
	}

	appendText(text: string) {
		const splitText = text.split('\n')
		const lastLine = splitText[splitText.length - 1]
		const lastLineLength = lastLine.length

		this.editor.replaceRange(text, this.curPos)

		this.curPos = {
			line: this.curPos.line + splitText.length - 1,
			ch:
				splitText.length > 1 ? lastLineLength : this.curPos.ch + lastLineLength
		}

		this.editor.scrollIntoView(
			{
				from: { line: this.curPos.line, ch: this.curPos.ch },
				to: { line: this.curPos.line, ch: this.curPos.ch }
			},
			true
		)
	}
}
