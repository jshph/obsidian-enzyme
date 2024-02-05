import { App, Notice, TFile } from 'obsidian'
import { AllCanvasNodeData } from 'obsidian/canvas'
import { ReasonNodeSpec, ReasonNodeType } from '../types'
import YAML from 'yaml'

export abstract class BaseReasonNodeBuilder<T> {
	type: ReasonNodeType
	color: string
	endpoint: string

	renderFrontmatter(spec: ReasonNodeSpec): string {
		return `---\n${YAML.stringify(spec)}\n---`
	}

	buildSpec(spec: any): any {
		return {
			role: ReasonNodeType[this.type],
			cssclasses: [`reason-node-${ReasonNodeType[this.type].toLowerCase()}`],
			...spec
		}
	}

	abstract renderBodyDataWithSpec(spec: ReasonNodeSpec, body: string): string

	async createReasonNodeFile(
		spec: any,
		createFile: (contents: string) => Promise<TFile>
	): Promise<void> {
		spec = this.buildSpec(spec)

		const body =
			this.renderFrontmatter(spec) +
			'\n' +
			this.renderBodyDataWithSpec(spec, '')

		const file = await createFile(body)

		new Notice(
			`Created a file for a new ${ReasonNodeType[this.type]} node at ${
				file.path
			}`
		)
	}
}
