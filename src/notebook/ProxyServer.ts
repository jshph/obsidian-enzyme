import cors from '@koa/cors' // eslint-disable-line import/no-extraneous-dependencies
import Koa from 'koa' // eslint-disable-line import/no-extraneous-dependencies
import proxy from 'koa-proxies'
import http from 'http'

/**
 * Used to proxy requests to the OpenAI API because the calls are being made from the `app://obsidian`
 */
export class ProxyServer {
	private server: http.Server | null = null
	private basePort: number = 3123
	constructor(
		targetURL: string,
		public baseURL: string
	) {
		const app = new Koa()
		app.use(cors())
		app.use(
			proxy('/', {
				target: targetURL,
				changeOrigin: true
			})
		)
		const startServer = () => {
			return new Promise<void>((resolve, reject) => {
				this.server = app
					.listen(this.basePort, () => {
						console.log(`Server running on port ${this.basePort}`)
						resolve()
					})
					.on('error', (e: NodeJS.ErrnoException) => {
						if (e.code === 'EADDRINUSE') {
							console.error(
								`Port ${this.basePort} is in use, trying port ${this.basePort + 1}`
							)
							this.basePort += 1
							startServer().then(resolve).catch(reject)
						} else {
							console.error('Error starting server:', e)
							reject(e)
						}
					})
			})
		}

		startServer().catch((e) => {
			console.error('Failed to start server:', e)
			throw e
		})
	}

	stop() {
		if (this.server) {
			this.server.close()
		}
	}
}
