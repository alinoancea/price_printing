const path = require('node:path')

process.env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173'
require(path.join(__dirname, '..', 'dist-electron', 'main.js'))

