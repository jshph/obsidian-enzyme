export interface EnzymeSettings {
	models: {
		model: string
		baseURL?: string
	}[]
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
	exclusionPatterns: string[]
}

export const DEFAULT_SETTINGS: EnzymeSettings = {
	models: [
		{
			model: 'claude-3-haiku-20240307'
		},
		{
			model: 'gpt-3.5-turbo-0125'
		},
		{
			model: 'gpt-4-0125-preview'
		},
		{
			model:
				'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q8_0.gguf',
			baseURL: 'http://localhost:1234/'
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
	},
	exclusionPatterns: ['daily/', '#reason/sample']
}
