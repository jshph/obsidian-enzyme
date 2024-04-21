export type ChatCompletionMessage = {
	role: 'user' | 'system' | 'assistant'
	content: string
}

export type BlockRefSubstitution = {
	template: string
	block_reference: string
}
