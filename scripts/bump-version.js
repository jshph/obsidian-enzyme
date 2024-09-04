const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Function to get the latest git tag
function getLatestTag() {
	const manifestPath = path.join(__dirname, '..', 'manifest.json')
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
	return `${manifest.version}`
}

// Function to get commit diff summary using LLM CLI tool
function getCommitDiffSummary(latestTag) {
	// Replace this with your actual LLM CLI tool command
	const summaryCommand = `git diff ${latestTag}..HEAD | llm -m gpt-4-0125-preview "Write a brief bulleted list of functional changes in this git diff, appropriate for revision history."`
	return execSync(summaryCommand).toString().trim()
}

// Function to bump version
function bumpVersion(currentVersion, summary) {
	// Implement your version bumping logic here
	// For this example, we'll just increment the patch version
	const [major, minor, patch] = currentVersion.split('.').map(Number)
	return `${major}.${minor}.${patch + 1}`
}

// Function to create a git tag with summary
function createGitTag(version, summary) {
	const tagMessage = `Version ${version}\n\n${summary}`
	execSync(`git tag -a v${version} -m "${tagMessage}"`)
	console.log(`Created git tag: v${version} with summary`)
}

// Main function
function main() {
	const manifestPath = path.join(__dirname, '..', 'manifest.json')
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

	const latestTag = getLatestTag()
	const summary = getCommitDiffSummary(latestTag)

	const newVersion = bumpVersion(manifest.version, summary)
	manifest.version = newVersion

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

	console.log(`Version bumped to ${newVersion}`)
	console.log('Summary of changes:')
	console.log(summary)

	// Create git tag with summary
	createGitTag(newVersion, summary)
}

main()
