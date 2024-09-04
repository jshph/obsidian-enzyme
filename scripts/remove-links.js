const fs = require('fs')
const path = require('path')

const linkPath = path.resolve(__dirname, '..', 'node_modules', 'enzyme-core')

if (fs.existsSync(linkPath) && fs.lstatSync(linkPath).isSymbolicLink()) {
	console.log('Removing enzyme-core symlink...')
	fs.unlinkSync(linkPath)
	console.log('Symlink removed.')
} else {
	console.log('No enzyme-core symlink found.')
}
