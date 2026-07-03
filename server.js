const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./goldorb_v2.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the database.');
});

// Build relational schemas
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        phone TEXT UNIQUE,
        password TEXT,
        balance REAL DEFAULT 0,
        commission REAL DEFAULT 0,
        referrals_count INTEGER DEFAULT 0,
        invitation_code TEXT UNIQUE,
        referred_by TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        product_name TEXT,
        price REAL,
        daily_income REAL,
        total_income REAL,
        status TEXT DEFAULT 'Active'
    )`);
});

// --- NEW AUTHENTICATION ROUTING SYSTEM ---

// 1. REGISTER NEW USER
app.post('/api/register', (req, res) => {
    const { phone, password, inviteCode } = req.body;
    if (!phone || !password) return res.json({ success: false, message: "Missing phone or password!" });

    // Generate a unique 7-digit invitation code for this new user
    const userInviteCode = Math.floor(1000000 + Math.random() * 9000000).toString();

    // Check if the phone already exists
    db.get("SELECT * FROM users WHERE phone = ?", [phone], (err, row) => {
        if (row) return res.json({ success: false, message: "Phone number already registered!" });

        if (inviteCode) {
            // Check if the person who referred them actually exists
            db.get("SELECT * FROM users WHERE invitation_code = ?", [inviteCode], (err, referrer) => {
                if (!referrer) return res.json({ success: false, message: "Invalid Referral Invite Code!" });

                // Add user and award referrer credit
                db.serialize(() => {
                    db.run("INSERT INTO users (phone, password, balance, commission, invitation_code, referred_by) VALUES (?, ?, 0, 0, ?, ?)", [phone, password, userInviteCode, referrer.phone]);
                    db.run("UPDATE users SET referrals_count = referrals_count + 1, commission = commission + 5000 WHERE phone = ?", [referrer.phone]);
                    res.json({ success: true, message: "Registration successful! You can now log in." });
                });
            });
        } else {
            // Register without referral code link
            db.run("INSERT INTO users (phone, password, balance, commission, invitation_code, referred_by) VALUES (?, ?, 0, 0, ?, NULL)", [phone, password, userInviteCode], (err) => {
                if (err) return res.json({ success: false, message: err.message });
                res.json({ success: true, message: "Registration successful! You can now log in." });
            });
        }
    });
});

// 2. USER LOGIN
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    db.get("SELECT * FROM users WHERE phone = ? AND password = ?", [phone, password], (err, user) => {
        if (!user) return res.json({ success: false, message: "Invalid phone number or password!" });
        res.json({ success: true, message: "Login successful!", phone: user.phone });
    });
});

// --- UPDATED DYNAMIC DASHBOARD PARAMETERS ---
app.get('/api/user/:phone', (req, res) => {
    const userPhone = req.params.phone;
    db.get("SELECT * FROM users WHERE phone = ?", [userPhone], (err, userRow) => {
        if (!userRow) return res.status(44).json({ error: "User profile missing" });
        db.all("SELECT * FROM orders WHERE phone = ?", [userPhone], (err, orderRows) => {
            res.json({ user: userRow, orders: orderRows });
        });
    });
});

app.post('/api/invest', (req, res) => {
    const { name, price, daily, total, phone } = req.body;
    db.get("SELECT balance FROM users WHERE phone = ?", [phone], (err, user) => {
        if (user.balance < price) return res.json({ success: false, message: "Insufficient balance!" });
        db.serialize(() => {
            db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [price, phone]);
            db.run("INSERT INTO orders (phone, product_name, price, daily_income, total_income) VALUES (?, ?, ?, ?, ?)", [phone, name, price, daily, total]);
            res.json({ success: true, message: `Successfully invested in ${name}!` });
        });
    });
});

app.post('/api/withdraw', (req, res) => {
    const { amount, type, phone } = req.body;
    db.get("SELECT * FROM users WHERE phone = ?", [phone], (err, user) => {
        let currentBalance = type === 'balance' ? user.balance : user.commission;
        if (currentBalance < amount) return res.json({ success: false, message: "Insufficient funds!" });
        let updateField = type === 'balance' ? 'balance' : 'commission';
        db.run(`UPDATE users SET ${updateField} = ${updateField} - ? WHERE phone = ?`, [amount, phone], () => {
            res.json({ success: true, message: `Successfully withdrew UGX ${amount}!` });
        });
    });
});

// --- ADMIN SYSTEM CONFIGURATIONS ---
app.get('/api/admin/users', (req, res) => {
    db.all("SELECT * FROM users", (err, users) => {
        db.all("SELECT * FROM orders", (err, orders) => {
            res.json({ users, orders });
        });
    });
});

app.post('/api/admin/update-balance', (req, res) => {
    const { phone, newBalance, type } = req.body;
    const field = type === 'balance' ? 'balance' : 'commission';
    db.run(`UPDATE users SET ${field} = ? WHERE phone = ?`, [parseFloat(newBalance), phone], () => {
        res.json({ success: true, message: `Updated user balance.` });
    });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));