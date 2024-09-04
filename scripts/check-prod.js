const fs = require('fs')
const path = require('path')

console.log('check-prod.js is running')
console.log('NODE_ENV:', process.env.NODE_ENV)
console.log('BUILD_PROD:', process.env.BUILD_PROD)

const npmrcPath = path.join(__dirname, '..', '.npmrc')

if (
	process.env.BUILD_PROD === 'true' ||
	(process.env.BUILD_PROD !== 'false' && process.env.NODE_ENV === 'production')
) {
	console.log('Production build detected. Using Github repo.')
	// Ensure .npmrc exists with GitHub configuration
	if (!fs.existsSync(npmrcPath)) {
		fs.writeFileSync(
			npmrcPath,
			'@jshph:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${GITHUB_ACCESS_TOKEN}\n'
		)
	}
} else {
	console.log('Development environment detected. Using local link.')
	// Remove .npmrc to use local link
	if (fs.existsSync(npmrcPath)) {
		fs.unlinkSync(npmrcPath)
	}
}
