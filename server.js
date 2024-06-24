const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
const path = require('path');

// express.static middleware to serve static files from 'public' directory
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Configure session middleware
app.use(session({
  secret: 'mykeysession', // Replace with your secret key
  resave: false,
  saveUninitialized: true,
  cookie: { secure: 'auto', httpOnly: true } // Set to true if using https
}));

// PostgreSQL connection settings
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
  });
  
// ENDPOINT INSERT TEMPERATURE TO DATABASE
app.post('/temperature_endpoint', async (req, res) => {
  try {
    const encryptedTemperature = req.body.data;
  
    console.log("Received temperature:", encryptedTemperature);
  
    // Insert data into PostgreSQL
    const query = 'INSERT INTO temperature_plain (temperature) VALUES ($1)';
    await pool.query(query, [encryptedTemperature]);
  
    res.send('Data received and stored.');
  } catch (error) {
      console.error('Database operation failed:', error);
      res.status(500).send('Server error');
    }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html')); // Send file HTML as response
});

// ENDPOINT LOGIN
app.post('/login', async function(req, res) {
  // Ekstrak username dan password dari req.body
  const { username, password } = req.body;
  
  try {
    // Query untuk mencari user dengan username yang diberikan
    const queryResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (queryResult.rows.length > 0) {
      const user = queryResult.rows[0];

      // Periksa jika password yang diberikan sesuai dengan yang ada di database
      if (password === user.password) {
        req.session.user = { username: user.username };
        res.json({ success: true });
      } else {
        res.json({ success: false, message: 'Incorrect username or password' });
      }
    } else {
      //username not found
      res.json({ success: false, message: 'Incorrect username or password' });
    }
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ENDPOINT LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            // handle error
            res.status(500).send('Could not log out');
        } else {
            res.clearCookie('connect.sid');
            res.json({ message: 'Logged out successfully' });
        }
    });
});

// Middleware to check if the user is logged in
function checkAuthenticated(req, res, next) {
  if (req.session.user) {
      next();
  } else {
      res.redirect('/login');
  }
}

// Middleware to check if the user is already logged in
function checkNotAuthenticated(req, res, next) {
  if (req.session.user) {
      res.redirect('/home');
  } else {
      next();
  }
}

// Home page route
app.get('/home', checkAuthenticated, (req, res) => {
  res.send('Welcome to the Home Page');
});

// Login page route
app.get('/login', checkNotAuthenticated, (req, res) => {
  res.send('Login Here');
});

// Function to decrypt data
function decrypt(encryptedData) {
  // Key dan IV harus sama dengan yang di ESP32
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(process.env.IV, 'hex');

  // Konversi hex string dari data suhu di database ke Buffer
  const encrypted = Buffer.from(encryptedData, 'hex');
  console.log('encrypted : ', encryptedData)
  try{
    // Inisialisasi dechipher
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true); // Aktifkan auto-padding untuk menghandle PKCS#7 padding
    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');

    console.log('decryted: ', decrypted)
    return decrypted;

  } catch (error) {
    console.error('Decrypt Error:', error.message);
    return null;
  }
}

// ENDPOINT RETRIEVE LATEST DATA FROM DB 

app.get('/getData', async (req, res) => {
  let start = performance.now();
  try {
    const result = await pool.query('SELECT temperature FROM temperature_plain ORDER BY id DESC LIMIT 1');
    if (result.rows.length > 0) {
      
      const plainData = result.rows[0].temperature;
      console.log('fetched: ', plainData)
      res.json({ Data: plainData });
    } else {
      // Mengirimkan respons jika tidak ada data yang ditemukan
      res.status(404).send('No temperature data found');
    }

    // Waktu akhir setelah data berhasil ditampilkan
    let end = performance.now();
    let time = end - start; // Durasi eksekusi dalam 
    console.log(`running time: ${time} milisekon`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Server error');
  }
});

//======================== TESTING =========================
// Fungsi untuk enkripsi data
function encrypt(data) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}


// Endpoint untuk enkripsi data
app.post('/encryptData', (req, res) => {
  const { data } = req.body;
  if (data) {
    const encryptedData = encrypt(data);
    res.json({ encryptedData });
  } else {
    res.status(400).send('No data provided');
  }
});

// Endpoint untuk mendekripsi data
app.post('/decryptData', (req, res) => {
  const { encryptedData } = req.body;
  if (encryptedData) {
    const decryptedData = decrypt(encryptedData);
    res.json({ decryptedData });
  } else {
    res.status(400).send('No encrypted data provided');
  }
});

// KONFIGURASI PORT
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));