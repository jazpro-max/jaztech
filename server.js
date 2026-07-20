// ===============================
// IMPORTS
// ===============================

require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const db = require("./db");

const app = express();

// ===============================
// SECURITY
// ===============================

app.use(helmet());

app.use(cors({
    origin: true,
    credentials: true
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: {
        message: "Too many requests. Please try again later."
    }
});

app.use(limiter);

// ===============================
// BODY PARSER
// ===============================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// STATIC FILES
// ===============================

app.use(express.static(path.join(__dirname, "public")));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ===============================
// FILE UPLOADS
// ===============================

const storage = multer.diskStorage({

    destination(req, file, cb) {

        cb(null, "uploads/");
    },

    filename(req, file, cb) {

        const uniqueName =
            Date.now() +
            "-" +
            uuidv4() +
            path.extname(file.originalname);

        cb(null, uniqueName);

    }

});

const upload = multer({

    storage,

    limits: {

        fileSize: 5 * 1024 * 1024

    },

    fileFilter(req, file, cb) {

        const allowed = [

            "image/png",
            "image/jpeg",
            "image/jpg",
            "application/pdf"

        ];

        if (allowed.includes(file.mimetype)) {

            cb(null, true);

        } else {

            cb(new Error("Unsupported file type"));

        }

    }

});

// ===============================
// HOME PAGE
// ===============================

app.get("/", (req, res) => {

    res.sendFile(path.join(__dirname, "public", "index.html"));

});
// ===============================
// JWT AUTHENTICATION
// ===============================

function generateToken(user) {

    return jwt.sign(

        {
            id: user.id,
            email: user.email
        },

        process.env.JWT_SECRET,

        {
            expiresIn: "7d"
        }

    );

}

function authenticateToken(req, res, next) {

    const authHeader = req.headers.authorization;

    if (!authHeader) {

        return res.status(401).json({
            message: "Access denied."
        });

    }

    const token = authHeader.split(" ")[1];

    jwt.verify(

        token,

        process.env.JWT_SECRET,

        (err, user) => {

            if (err) {

                return res.status(403).json({
                    message: "Invalid token."
                });

            }

            req.user = user;

            next();

        }

    );

}

// ===============================
// REGISTER
// ===============================

app.post("/api/register", async (req, res) => {

    try {

        const {

            name,
            email,
            phone,
            password,
            referralCode

        } = req.body;

        const existing = await db.query(

            "SELECT id FROM users WHERE email=$1 OR phone=$2",

            [email, phone]

        );

        if (existing.rows.length > 0) {

            return res.status(400).json({

                message: "Email or phone already exists."

            });

        }

        const hashedPassword =

            await bcrypt.hash(password, 10);

        const result = await db.query(

            `INSERT INTO users
            (name,email,phone,password,referral_code)
            VALUES($1,$2,$3,$4,$5)
            RETURNING id,name,email,phone`,

            [

                name,

                email,

                phone,

                hashedPassword,

                referralCode || null

            ]

        );

        const user = result.rows[0];

        const token = generateToken(user);

        res.status(201).json({

            token,

            user

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Registration failed."

        });

    }

});

// ===============================
// LOGIN
// ===============================

app.post("/api/login", async (req, res) => {

    try {

        const {

            email,
            password

        } = req.body;

        const result = await db.query(

            "SELECT * FROM users WHERE email=$1 OR phone=$1",

            [email]

        );

        if (result.rows.length === 0) {

            return res.status(401).json({

                message: "Invalid credentials."

            });

        }

        const user = result.rows[0];

        const valid = await bcrypt.compare(

            password,

            user.password

        );

        if (!valid) {

            return res.status(401).json({

                message: "Invalid credentials."

            });

        }

        const token = generateToken(user);

        res.json({

            token,

            user: {

                id: user.id,

                name: user.name,

                email: user.email,

                phone: user.phone

            }

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Login failed."

        });

    }

});
// ===============================
// GET PROFILE
// ===============================

app.get("/api/profile", authenticateToken, async (req, res) => {

    try {

        const result = await db.query(

            `SELECT
                name,
                email,
                phone,
                country,
                city,
                address,
                photo
             FROM users
             WHERE id=$1`,

            [req.user.id]

        );

        if(result.rows.length===0){

            return res.status(404).json({
                message:"User not found."
            });

        }

        res.json(result.rows[0]);

    } catch(error){

        console.error(error);

        res.status(500).json({
            message:"Failed to load profile."
        });

    }

});

// ===============================
// UPDATE PROFILE
// ===============================

app.put(
"/api/profile",
authenticateToken,
upload.single("photo"),

async(req,res)=>{

try{

const{

name,
email,
phone,
country,
city,
address

}=req.body;

let photoPath=null;

if(req.file){

photoPath="/uploads/"+req.file.filename;

await db.query(

`UPDATE users
SET
name=$1,
email=$2,
phone=$3,
country=$4,
city=$5,
address=$6,
photo=$7
WHERE id=$8`,

[
name,
email,
phone,
country,
city,
address,
photoPath,
req.user.id
]

);

}else{

await db.query(

`UPDATE users
SET
name=$1,
email=$2,
phone=$3,
country=$4,
city=$5,
address=$6
WHERE id=$7`,

[
name,
email,
phone,
country,
city,
address,
req.user.id
]

);

}

res.json({

message:"Profile updated successfully."

});

}catch(error){

console.error(error);

res.status(500).json({

message:"Unable to update profile."

});

}

});

// ===============================
// CHANGE PASSWORD
// ===============================

app.post(
"/api/change-password",
authenticateToken,
async(req,res)=>{

try{

const{

currentPassword,
newPassword

}=req.body;

const result=await db.query(

"SELECT password FROM users WHERE id=$1",

[req.user.id]

);

const user=result.rows[0];

const valid=

await bcrypt.compare(

currentPassword,

user.password

);

if(!valid){

return res.status(400).json({

message:"Current password is incorrect."

});

}

const hashed=

await bcrypt.hash(

newPassword,

10

);

await db.query(

"UPDATE users SET password=$1 WHERE id=$2",

[hashed,req.user.id]

);

res.json({

message:"Password updated successfully."

});

}catch(error){

console.error(error);

res.status(500).json({

message:"Password update failed."

});

}

});

// ===============================
// CHANGE TRANSACTION PIN
// ===============================

app.post(
"/api/change-pin",
authenticateToken,
async(req,res)=>{

try{

const{

currentPin,
newPin

}=req.body;

const result=

await db.query(

"SELECT pin FROM users WHERE id=$1",

[req.user.id]

);

if(

result.rows.length===0

){

return res.status(404).json({

message:"User not found."

});

}

if(

result.rows[0].pin!==currentPin

){

return res.status(400).json({

message:"Current PIN is incorrect."

});

}

await db.query(

"UPDATE users SET pin=$1 WHERE id=$2",

[newPin,req.user.id]

);

res.json({

message:"PIN updated successfully."

});

}catch(error){

console.error(error);

res.status(500).json({

message:"Unable to update PIN."

});

}

});

// ===============================
// SETTINGS
// ===============================

app.get(
"/api/settings",
authenticateToken,
async(req,res)=>{

try{

const result=

await db.query(

`SELECT
two_factor,
deposit_alert,
withdraw_alert,
profit_alert,
referral_alert,
dark_mode,
language
FROM users
WHERE id=$1`,

[req.user.id]

);

res.json({

twoFactor:result.rows[0].two_factor,

depositAlert:result.rows[0].deposit_alert,

withdrawAlert:result.rows[0].withdraw_alert,

profitAlert:result.rows[0].profit_alert,

referralAlert:result.rows[0].referral_alert,

darkMode:result.rows[0].dark_mode,

language:result.rows[0].language

});

}catch(error){

console.error(error);

res.status(500).json({

message:"Unable to load settings."

});

}

});

app.put(
"/api/settings",
authenticateToken,
async(req,res)=>{

try{

const{

twoFactor,
depositAlert,
withdrawAlert,
profitAlert,
referralAlert,
darkMode,
language

}=req.body;

await db.query(

`UPDATE users SET
two_factor=$1,
deposit_alert=$2,
withdraw_alert=$3,
profit_alert=$4,
referral_alert=$5,
dark_mode=$6,
language=$7
WHERE id=$8`,

[
twoFactor,
depositAlert,
withdrawAlert,
profitAlert,
referralAlert,
darkMode,
language,
req.user.id
]

);

res.json({

message:"Settings updated successfully."

});

}catch(error){

console.error(error);

res.status(500).json({

message:"Unable to save settings."

});

}

});
// ===============================
// DASHBOARD
// ===============================

app.get("/api/dashboard", authenticateToken, async (req, res) => {

    try {

        const wallet = await db.query(
            "SELECT balance FROM wallets WHERE user_id=$1",
            [req.user.id]
        );

        const investments = await db.query(
            "SELECT COUNT(*) FROM investments WHERE user_id=$1",
            [req.user.id]
        );

        const deposits = await db.query(
            "SELECT COUNT(*) FROM deposits WHERE user_id=$1",
            [req.user.id]
        );

        const withdrawals = await db.query(
            "SELECT COUNT(*) FROM withdrawals WHERE user_id=$1",
            [req.user.id]
        );

        res.json({

            balance: wallet.rows[0]?.balance || 0,

            investments: Number(investments.rows[0].count),

            deposits: Number(deposits.rows[0].count),

            withdrawals: Number(withdrawals.rows[0].count)

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Dashboard error."
        });

    }

});

// ===============================
// INVESTMENT PLANS
// ===============================

app.get("/api/investment-plans", async (req, res) => {

    try {

        const result = await db.query(

            "SELECT * FROM investment_plans ORDER BY minimum_amount ASC"

        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to load plans."
        });

    }

});

// ===============================
// CREATE INVESTMENT
// ===============================

app.post("/api/invest", authenticateToken, async (req, res) => {

    try {

        const { planId, amount } = req.body;

        await db.query(

            `INSERT INTO investments
            (user_id,plan_id,amount,status,created_at)
            VALUES($1,$2,$3,'Active',NOW())`,

            [req.user.id, planId, amount]

        );

        res.json({

            message: "Investment created successfully."

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Investment failed."

        });

    }

});

// ===============================
// DEPOSIT
// ===============================

app.post(
"/api/deposit",
authenticateToken,
upload.single("proof"),

async(req,res)=>{

try{

const { amount, method } = req.body;

const proof = req.file
? "/uploads/" + req.file.filename
: null;

await db.query(

`INSERT INTO deposits
(user_id,amount,method,proof,status,created_at)
VALUES($1,$2,$3,$4,'Pending',NOW())`,

[
req.user.id,
amount,
method,
proof
]

);

res.json({

message:"Deposit submitted successfully."

});

}catch(error){

console.error(error);

res.status(500).json({

message:"Deposit failed."

});

}

});

// ===============================
// WITHDRAW
// ===============================

app.post("/api/withdraw", authenticateToken, async (req, res) => {

    try {

        const {

            amount,
            walletAddress

        } = req.body;

        await db.query(

            `INSERT INTO withdrawals
            (user_id,amount,wallet_address,status,created_at)
            VALUES($1,$2,$3,'Pending',NOW())`,

            [
                req.user.id,
                amount,
                walletAddress
            ]

        );

        res.json({

            message: "Withdrawal request submitted."

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Withdrawal failed."

        });

    }

});

// ===============================
// TRANSACTIONS
// ===============================

app.get("/api/transactions", authenticateToken, async (req, res) => {

    try {

        const result = await db.query(

            `SELECT *
             FROM transactions
             WHERE user_id=$1
             ORDER BY created_at DESC`,

            [req.user.id]

        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Unable to load transactions."

        });

    }

});
// ===============================
// REFERRALS
// ===============================

app.get("/api/referrals", authenticateToken, async (req, res) => {

    try {

        const result = await db.query(

            `SELECT
                id,
                name,
                email,
                created_at
             FROM users
             WHERE referred_by=$1
             ORDER BY created_at DESC`,

            [req.user.id]

        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to load referrals."
        });

    }

});

// ===============================
// NOTIFICATIONS
// ===============================

app.get("/api/notifications", authenticateToken, async (req, res) => {

    try {

        const result = await db.query(

            `SELECT *
             FROM notifications
             WHERE user_id=$1
             ORDER BY created_at DESC`,

            [req.user.id]

        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to load notifications."
        });

    }

});

// ===============================
// SUPPORT TICKETS
// ===============================

app.post("/api/support", authenticateToken, async (req, res) => {

    try {

        const {

            subject,
            message

        } = req.body;

        await db.query(

            `INSERT INTO support_tickets
            (user_id,subject,message,status,created_at)
            VALUES($1,$2,$3,'Open',NOW())`,

            [

                req.user.id,

                subject,

                message

            ]

        );

        res.json({

            message: "Support ticket submitted."

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Unable to create support ticket."

        });

    }

});

app.get("/api/support", authenticateToken, async (req, res) => {

    try {

        const result = await db.query(

            `SELECT *
             FROM support_tickets
             WHERE user_id=$1
             ORDER BY created_at DESC`,

            [req.user.id]

        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Unable to load support tickets."

        });

    }

});

// ===============================
// ADMIN DASHBOARD
// ===============================

app.get("/api/admin/dashboard", authenticateToken, async (req, res) => {

    try {

        const users = await db.query(
            "SELECT COUNT(*) FROM users"
        );

        const deposits = await db.query(
            "SELECT COUNT(*) FROM deposits"
        );

        const withdrawals = await db.query(
            "SELECT COUNT(*) FROM withdrawals"
        );

        const investments = await db.query(
            "SELECT COUNT(*) FROM investments"
        );

        res.json({

            users: Number(users.rows[0].count),

            deposits: Number(deposits.rows[0].count),

            withdrawals: Number(withdrawals.rows[0].count),

            investments: Number(investments.rows[0].count)

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Unable to load admin dashboard."

        });

    }

});

// ===============================
// GLOBAL ERROR HANDLER
// ===============================

app.use((err, req, res, next) => {

    console.error(err.stack);

    res.status(500).json({

        message: "Internal Server Error."

    });

});

// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(`🚀 Server running on port ${PORT}`);

});