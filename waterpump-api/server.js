const express = require('express')
const mysql = require('mysql2/promise')
require('dotenv').config()

const app = express()
app.use(express.json())

async function start() {
    const listDB = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    })

    const apiPump = require('./apiPump')
    apiPump(app, listDB, {}, {}, listDB, null, null)

    const PORT = process.env.PORT || 3100
    app.listen(PORT, () => console.log(`🚀 Running on http://localhost:${PORT}`))
}

start()