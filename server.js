const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static directory (Public folder)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ================= PAGE ROUTING ================= //

// Default Main Entry Point (Renamed to index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Explicit Authentication Pages (Full window loads)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Admin Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all 404 Route
app.use((req, res) => {
    res.status(404).send('404 - Page or Resource Not Found in public directory.');
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
