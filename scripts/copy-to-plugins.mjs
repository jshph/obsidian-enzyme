import fs from 'fs/promises'
import path from 'path'
import os from 'os'

export async function copyToPlugins() {
	// Define source and destination paths
	const sourceDir = path.join(
		path.dirname(new URL(import.meta.url).pathname),
		'..'
	)
	const destDir = path.join(
		os.homedir(),
		'Documents',
		'obsidian',
		'.obsidian',
		'plugins',
		'reason'
	)

	// Files to copy
	const filesToCopy = ['main.js', 'manifest.json', 'styles.css']

	// Ensure the destination directory exists
	await fs.mkdir(destDir, { recursive: true })

	// Copy each file
	for (const file of filesToCopy) {
		const sourcePath = path.join(sourceDir, file)
		const destPath = path.join(destDir, file)

		try {
			await fs.copyFile(sourcePath, destPath)
		} catch (err) {
			console.error(`Error copying ${file}: ${err}`)
		}
	}
}

// If this script is run directly, execute the function
if (import.meta.url === `file://${process.argv[1]}`) {
	copyToPlugins().then(() => console.log('Copy process completed.'))
}
