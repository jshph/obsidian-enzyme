import { App, Modal } from 'obsidian'
import { machineId } from 'node-machine-id'
// @ts-ignore
import { API_BASE_URL } from 'env'

export class RegistrationManager {
	registerModal: Modal
	licenseKey: string

	public constructor(public app: App) {
		this.registerModal = new Modal(this.app)
		this.registerModal.contentEl.innerHTML =
			'<p>During early-access, Reason is free. Contact <a href="mailto:josh@reason.garden">josh@reason.garden</a> for a license key to make this modal disappear. If you want to support development (thank you!), you can <a href="https://www.buymeacoffee.com/jpham">buy me a ☕️</a>.</p>'
	}

	public async validateLicense(): Promise<boolean> {
		// Don't halt plugin init if we can't validate the license
		if (!this.licenseKey || this.licenseKey === '') {
			return false
		}

		const payload = {
			key: this.licenseKey || ''
		}
		const response = await fetch(API_BASE_URL + '/validate-license', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(payload)
		})
		if (response.status !== 200) {
			return false
		} else {
			return true
		}
	}

	public async activateLicense(): Promise<boolean> {
		if (!this.licenseKey || this.licenseKey === '') {
			return false
		}

		const payload = {
			fingerprint: await machineId(),
			key: this.licenseKey || ''
		}

		const response = await fetch(API_BASE_URL + '/activate-license', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(payload)
		})
		if (response.status !== 200) {
			return false
		} else {
			return true
		}
	}

	public setLicense(key: string): void {
		this.licenseKey = key
	}

	public openRegisterModal() {
		this.registerModal.open()
	}
}
