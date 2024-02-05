export type ChatCompletionMessage = {
	role: 'user' | 'system' | 'assistant'
	content: string
}

import { CanvasTextData } from 'obsidian/canvas'

export enum ReasonNodeType {
	Source,
	Aggregator,
	Synthesis
}

export type ReasonNodeSpec = {
	id: string
	guidance: string
	role: string
}

export interface ReasonNodeData extends CanvasTextData {
	role: ReasonNodeType
	spec: any
}

export type RenderedSpec = {
	spec: any
	body: string
}

export type BlockRefSubstitution = {
	template: string
	block_reference: string
}
