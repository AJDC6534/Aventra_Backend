// File: server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/db');

// Initialize app and connect DB
const app = express();
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads/profiles', express.static('uploads'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/itineraries', require('./routes/itineraries'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/emergency', require('./routes/emergency'));

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
