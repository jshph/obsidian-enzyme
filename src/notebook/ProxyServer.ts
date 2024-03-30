import cors from '@koa/cors'
import Koa from 'koa'
import proxy from 'koa-proxies'
import http from 'http'

export class ProxyServer {
	private server: http.Server | null = null
	constructor(
		url: string,
		private port: number
	) {
		const app = new Koa()
		app.use(cors())
		app.use(
			proxy('/', {
				target: url,
				changeOrigin: true
			})
		)

		this.server = app.listen(this.port, () => {
			console.log(`Server running on port ${this.port}`)
		})
	}

	stop() {
		if (this.server) {
			this.server.close()
		}
	}
}
