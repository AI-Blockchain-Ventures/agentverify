import { copyFileSync } from 'fs'

copyFileSync('public/logo.png', 'public/favicon.ico')
console.log('Copied logo.png to favicon.ico')
