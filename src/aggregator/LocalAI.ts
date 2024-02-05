// import { fileURLToPath } from 'url'
// import path from 'path'

// import { ChatCompletionMessage } from '../types'
// import { Token } from 'node-llama-cpp'

// export type LlamaOptions = {
// 	streaming: boolean
// 	grammar?: any
// 	systemPrompt?: string
// }

// let llamaChatSession: CallableFunction
// let llamaChatPromptWrapper: CallableFunction
// let llamaModel: CallableFunction
// let llamaContext: CallableFunction

// export class LocalAI {
// 	llamaModule: any
// 	context: any
// 	constructor(public plugin: ReasonPlugin) {}

// 	// TODO will wait for ESM
// 	// async initModel() {
// 	//   (async () => {
// 	//     const  { LlamaModel, LlamaContext, LlamaChatSession, LlamaChatPromptWrapper } = await import('node-llama-cpp')
// 	//     llamaModel = LlamaModel
// 	//     llamaContext = LlamaContext
// 	//     llamaChatSession = LlamaChatSession
// 	//     llamaChatPromptWrapper = LlamaChatPromptWrapper
// 	//   })()

// 	// 	// this.llamaModule = await loadLlama()
// 	// 	const model = new llamaModel({
// 	// 		modelPath: path.join(this.plugin.settings.localModelPath)
// 	// 	})
// 	// 	this.context = new llamaContext({ model })
// 	// }

// 	async generate(
// 		history: ChatCompletionMessage[],
// 		options?: LlamaOptions
// 	): Promise<AsyncIterable<string>> {
// 		const formattedMsgs: any[] = []
// 		for (let i = 0; i < history.length - 1; i += 2) {
// 			if (i + 2 > history.length) break // last prompt won't have a matching response
// 			const chunk = history.slice(i, i + 2)
// 			// Assuming history is an array of ChatCompletionMessage and each message has a prompt and response
// 			const interaction: any = {
// 				prompt: chunk[0].content,
// 				response: chunk[1].content
// 			}
// 			formattedMsgs.push(interaction)
// 		}

// 		const session = new llamaChatSession({
// 			context: this.context,
// 			promptWrapper: new llamaChatPromptWrapper(), // by default, GeneralChatPromptWrapper is used
// 			conversationHistory: formattedMsgs,
// 			systemPrompt: options?.systemPrompt
// 		})

// 		const prompt = history[history.length - 1].content

// 		if (!options?.streaming) {
// 			return (async function* () {
// 				let promptOptions = {} as LlamaOptions
// 				if (options?.grammar) {
// 					promptOptions.grammar = options.grammar
// 				}
// 				yield await session.prompt(prompt, promptOptions)
// 			})()
// 		} else {
// 			return (async function* () {
// 				let queue: string[] = []
// 				let done = false

// 				session
// 					.prompt(prompt, {
// 						onToken: (chunk: Token[]) => {
// 							queue.push(this.context.decode(chunk))
// 						},
// 						grammar: options?.grammar
// 					})
// 					.then(() => {
// 						done = true
// 					})

// 				while (!done || queue.length > 0) {
// 					if (queue.length > 0) {
// 						yield queue.shift()
// 					} else {
// 						await new Promise((resolve) => setTimeout(resolve, 100))
// 					}
// 				}
// 			})()
// 		}
// 	}
// }
