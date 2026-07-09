const express = require('express');
const path = require('path');
const { Pool } = require('pg'); // PostgreSQL client pool
const session = require('express-session');

const app = express();

// 1. Core Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup tracking sessions so the dashboard knows WHICH user is active
app.use(session({
    secret: 'gold-orb-secret-key-abcde',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Session expires in 24 hours
}));

// Serve static frontend assets cleanly out of your public directory
app.use(express.static(path.join(__dirname, 'public')));

// 2. Initialize PostgreSQL Connection Pool
// Render automatically provides process.env.DATABASE_URL when you attach a PostgreSQL database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for secure connections to Render Postgres
    }
});

// Create tables automatically if they don't exist
const initializeDatabase = async () => {
    try {
        // Setup User Management Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                phone TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance NUMERIC(15, 2) DEFAULT 0.00,
                commission NUMERIC(15, 2) DEFAULT 0.00,
                invitation_code TEXT
            )
        `);

        // Setup Active Investment Leases Tracking Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_phone TEXT NOT NULL,
                product_name TEXT NOT NULL,
                price NUMERIC(15, 2) NOT NULL,
                daily_income NUMERIC(15, 2) NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("PostgreSQL Database tables verified/created successfully.");
    } catch (err) {
        console.error("Error creating database tables:", err.message);
    }
};
initializeDatabase();

// ==========================================
// 🔐 AUTHENTICATION ENDPOINTS (For login.html)
// ==========================================

// Register Account Pipeline
app.post('/api/auth/register', async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ success: false, message: "Phone and password values required." });
    }

    const assignedInviteCode = Math.floor(1000000 + Math.random() * 9000000).toString();
    const query = `INSERT INTO users (phone, password, balance, commission, invitation_code) VALUES ($1, $2, 0, 0, $3)`;
    
    try {
        await pool.query(query, [phone, password, assignedInviteCode]);
        req.session.userPhone = phone; // Log them in automatically
        return res.json({ success: true, message: "Account created successfully!" });
    } catch (err) {
        if (err.code === '23505') { // PostgreSQL unique violation error code
            return res.json({ success: false, message: "This phone number is already registered!" });
        }
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal server registry error." });
    }
});

// Authenticate Session Access Login
app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;

    try {
        const result = await pool.query(`SELECT * FROM users WHERE phone = $1 AND password = $2`, [phone, password]);
        
        if (result.rows.length === 0) {
            return res.json({ success: false, message: "Incorrect phone number or password." });
        }

        // Save active identity reference inside session storage
        req.session.userPhone = result.rows[0].phone;
        return res.json({ success: true, message: "Login successful!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "System core connection drop." });
    }
});


// ==========================================
// 📊 DASHBOARD & MACHINE STORAGE ENDPOINTS
// ==========================================

// Pull live profile telemetry for the logged-in user
app.get('/api/user/profile', async (req, res) => {
    if (!req.session.userPhone) {
        return res.status(401).json({ success: false, message: "Session unauthorized. Re-login required." });
    }

    const phone = req.session.userPhone;

    try {
        // Fetch user details
        const userResult = await pool.query(`SELECT phone, balance, commission, invitation_code FROM users WHERE phone = $1`, [phone]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Profile matching error." });
        }

        // Fetch their active investment orders
        const ordersResult = await pool.query(`SELECT product_name, price, daily_income FROM orders WHERE user_phone = $1`, [phone]);

        return res.json({
            phone: userResult.rows[0].phone,
            balance: parseFloat(userResult.rows[0].balance),
            commission: parseFloat(userResult.rows[0].commission),
            invitation_code: userResult.rows[0].invitation_code,
            orders: ordersResult.rows || []
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to map user portfolio state." });
    }
});

// Process a Lease Investment Machine Purchase
app.post('/api/user/buy-product', async (req, res) => {
    if (!req.session.userPhone) {
        return res.status(401).json({ success: false, message: "Unauthenticated action attempt." });
    }

    const phone = req.session.userPhone;
    const { productName, price, dailyIncome } = req.body;

    try {
        // Look up wallet to verify if they have enough money
        const userResult = await pool.query(`SELECT balance FROM users WHERE phone = $1`, [phone]);
        if (userResult.rows.length === 0) return res.status(500).json({ success: false, message: "Verification processing failed." });

        const currentBalance = parseFloat(userResult.rows[0].balance);
        if (currentBalance < price) {
            return res.json({ success: false, message: "Insufficient balance to lease this machine!" });
        }

        // Use standard atomic transactional queries to protect system state matches
        await pool.query('BEGIN');
        
        // Deduct balance funds out of wallet data sheet
        await pool.query(`UPDATE users SET balance = balance - $1 WHERE phone = $2`, [price, phone]);
        
        // Provision investment hardware record mapping
        await pool.query(`INSERT INTO orders (user_phone, product_name, price, daily_income) VALUES ($1, $2, $3, $4)`, 
            [phone, productName, price, dailyIncome]);
        
        await pool.query('COMMIT');
        return res.json({ success: true, message: "Machine leased and processing successfully!" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        return res.status(500).json({ success: false, message: "Hardware binding failure." });
    }
});

// Administrative Adjustments (Recharge / Manual subtracts)
app.post('/api/admin/update-balance', async (req, res) => {
    const { phone, newBalance, type } = req.body;
    const amount = parseFloat(newBalance);

    let query = `UPDATE users SET balance = balance + $1 WHERE phone = $2`;
    if (type === 'balance_subtract') {
        query = `UPDATE users SET balance = balance - $1 WHERE phone = $2`;
    }

    try {
        await pool.query(query, [amount, phone]);
        return res.json({ success: true, message: "Ledger status balanced successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Admin system balance sync failed." });
    }
});

// Global Router Catch-all (Redirect default requests gracefully to login)
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Boot up Listener 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Gold Orb PostgreSQL Node server running flawlessly on port ${PORT}`));
    
