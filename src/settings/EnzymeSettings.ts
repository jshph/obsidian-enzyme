import { ModelConfig } from 'enzyme-core'

export interface EnzymeSettings {
	models: ModelConfig[]
	selectedModel: string
	/**
	 * Enable debug output in the console
	 */
	debug: boolean

	localModelPath?: string

	basicExtractionFolders: string[]

	trimFolders: string[]

	visualizeSourceInGraph: boolean
	apiKeys: {
		openai: string
		anthropic: string
	}
}

export const DEFAULT_SETTINGS: EnzymeSettings = {
	models: [
		{
			model: 'claude-3-haiku-20240307',
			provider: 'anthropic',
			baseURL: 'https://api.anthropic.com/v1'
		},
		{
			model: 'gpt-3.5-turbo-0125',
			provider: 'openai',
			baseURL: 'https://api.openai.com/v1'
		},
		{
			model: 'gpt-4-0125-preview',
			provider: 'openai',
			baseURL: 'https://api.openai.com/v1'
		},
		{
			model:
				'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q8_0.gguf',
			baseURL: 'http://localhost:1234/v1'
		}
	],
	selectedModel: 'Haiku',
	debug: false,
	localModelPath: undefined,
	basicExtractionFolders: [],
	trimFolders: [],
	visualizeSourceInGraph: false,
	apiKeys: {
		openai: '',
		anthropic: ''
	}
}
