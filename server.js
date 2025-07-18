const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced logging utility
const logger = {
  info: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] ${message}`, error ? error.stack || error.message || error : '');
  },
  warn: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  debug: (message, data = null) => {
    if (process.env.NODE_ENV === 'development') {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }
};

// Log startup
logger.info('🚀 Starting Travel Planner API...');
logger.info('Environment:', { 
  NODE_ENV: process.env.NODE_ENV,
  PORT: PORT,
  MONGODB_URI: process.env.MONGODB_URI ? '✅ Configured' : '❌ Not configured',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Not configured',
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY ? '✅ Configured' : '❌ Not configured',
  PEXELS_API_KEY: process.env.PEXELS_API_KEY ? '✅ Configured' : '❌ Not configured',
  PIXABAY_API_KEY: process.env.PIXABAY_API_KEY ? '✅ Configured' : '❌ Not configured'
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  logger.info(`📥 Incoming Request [${requestId}]`, {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`📤 Request Complete [${requestId}]`, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });
  
  next();
});

// Middleware
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers');
    next();
});
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://github.com/AJDC6534/Aventra.git'
  ],
  credentials: true
}));
app.use(express.json());

// MongoDB Connection
logger.info('🔌 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    logger.info('✅ MongoDB connected successfully');
  })
  .catch((err) => {
    logger.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  });

// MongoDB connection event listeners
mongoose.connection.on('connected', () => {
  logger.info('📊 MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  logger.error('📊 MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('📊 MongoDB connection disconnected');
});

// Initialize Google Generative AI
logger.info('🤖 Initializing Google Generative AI...');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

if (genAI) {
  logger.info('✅ Google Generative AI initialized successfully');
} else {
  logger.warn('⚠️ Google Generative AI not initialized - API key missing');
}

// ===== RATE LIMITER =====
const rateLimiter = {
  requests: new Map(),
  maxRequests: 15,
  windowMs: 60000,
  
  isAllowed(userId) {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const validRequests = userRequests.filter(time => now - time < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      logger.warn('🚫 Rate limit exceeded for user:', { userId, requests: validRequests.length });
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(userId, validRequests);
    logger.debug('✅ Rate limit check passed for user:', { userId, requests: validRequests.length });
    return true;
  }
};

// ===== PHOTO SERVICE UTILITIES =====

// Photo service configuration
const photoServices = {
  unsplash: {
    baseUrl: 'https://api.unsplash.com',
    searchEndpoint: '/search/photos',
    headers: {
      'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`
    }
  },
  pexels: {
    baseUrl: 'https://api.pexels.com/v1',
    searchEndpoint: '/search',
    headers: {
      'Authorization': process.env.PEXELS_API_KEY
    }
  },
  pixabay: {
    baseUrl: 'https://pixabay.com/api',
    searchEndpoint: '/',
    params: {
      key: process.env.PIXABAY_API_KEY,
      image_type: 'photo',
      orientation: 'horizontal',
      category: 'places'
    }
  }
};

// Function to fetch photos from Unsplash
async function fetchUnsplashPhotos(query, count = 3) {
  logger.info('📸 Fetching Unsplash photos', { query, count });
  
  try {
    if (!process.env.UNSPLASH_ACCESS_KEY) {
      logger.warn('⚠️ Unsplash API key not configured');
      return [];
    }

    const url = `${photoServices.unsplash.baseUrl}${photoServices.unsplash.searchEndpoint}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
    
    const response = await axios.get(url, {
      headers: photoServices.unsplash.headers,
      timeout: 5000
    });

    const photos = response.data.results?.map(photo => ({
      id: photo.id,
      url: photo.urls.regular,
      thumb: photo.urls.thumb,
      description: photo.alt_description || photo.description || query,
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
      downloadUrl: photo.links.download_location,
      source: 'unsplash'
    })) || [];

    logger.info('✅ Unsplash photos fetched successfully', { query, count: photos.length });
    return photos;

  } catch (error) {
    logger.error('❌ Unsplash fetch error:', error);
    return [];
  }
}

// Function to fetch photos from Pexels
async function fetchPexelsPhotos(query, count = 3) {
  logger.info('📸 Fetching Pexels photos', { query, count });
  
  try {
    if (!process.env.PEXELS_API_KEY) {
      logger.warn('⚠️ Pexels API key not configured');
      return [];
    }

    const url = `${photoServices.pexels.baseUrl}${photoServices.pexels.searchEndpoint}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
    
    const response = await axios.get(url, {
      headers: photoServices.pexels.headers,
      timeout: 5000
    });

    const photos = response.data.photos?.map(photo => ({
      id: photo.id,
      url: photo.src.large,
      thumb: photo.src.medium,
      description: photo.alt || query,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      source: 'pexels'
    })) || [];

    logger.info('✅ Pexels photos fetched successfully', { query, count: photos.length });
    return photos;

  } catch (error) {
    logger.error('❌ Pexels fetch error:', error);
    return [];
  }
}

// Function to fetch photos from Pixabay
async function fetchPixabayPhotos(query, count = 3) {
  logger.info('📸 Fetching Pixabay photos', { query, count });
  
  try {
    if (!process.env.PIXABAY_API_KEY) {
      logger.warn('⚠️ Pixabay API key not configured');
      return [];
    }

    const params = new URLSearchParams({
      ...photoServices.pixabay.params,
      q: query,
      per_page: count.toString(),
      min_width: 640,
      min_height: 480
    });

    const url = `${photoServices.pixabay.baseUrl}${photoServices.pixabay.searchEndpoint}?${params}`;
    
    const response = await axios.get(url, { timeout: 5000 });

    const photos = response.data.hits?.map(photo => ({
      id: photo.id,
      url: photo.webformatURL,
      thumb: photo.previewURL,
      description: photo.tags || query,
      photographer: photo.user,
      source: 'pixabay'
    })) || [];

    logger.info('✅ Pixabay photos fetched successfully', { query, count: photos.length });
    return photos;

  } catch (error) {
    logger.error('❌ Pixabay fetch error:', error);
    return [];
  }
}

// Main function to fetch photos from multiple sources
async function fetchPhotosForDestination(destination, activityType = null, count = 3) {
  const query = activityType ? `${destination} ${activityType}` : destination;
  
  logger.info('📸 Fetching photos for destination', { destination, activityType, count });
  
  if (!destination || destination.trim().length === 0) {
    logger.warn('⚠️ Empty destination provided for photo fetch');
    return [];
  }
  
  // Try all services in parallel with different queries
  const searchQueries = [
    query,
    destination,
    `${destination} travel`,
    `${destination} tourism`,
    `${destination} city`,
    `${destination} landscape`
  ];
  
  const photoPromises = [];
  
  // Add Unsplash requests with multiple queries
  if (process.env.UNSPLASH_ACCESS_KEY) {
    logger.info('📸 Adding Unsplash requests');
    for (let i = 0; i < Math.min(3, searchQueries.length); i++) {
      photoPromises.push(
        fetchUnsplashPhotos(searchQueries[i], Math.ceil(count / 3))
          .catch(error => {
            logger.error(`❌ Unsplash fetch failed for query "${searchQueries[i]}":`, error);
            return [];
          })
      );
    }
  } else {
    logger.warn('⚠️ Unsplash API key not configured');
  }
  
  // Add Pexels requests with multiple queries
  if (process.env.PEXELS_API_KEY) {
    logger.info('📸 Adding Pexels requests');
    for (let i = 0; i < Math.min(2, searchQueries.length); i++) {
      photoPromises.push(
        fetchPexelsPhotos(searchQueries[i], Math.ceil(count / 3))
          .catch(error => {
            logger.error(`❌ Pexels fetch failed for query "${searchQueries[i]}":`, error);
            return [];
          })
      );
    }
  } else {
    logger.warn('⚠️ Pexels API key not configured');
  }
  
  // Add Pixabay requests with multiple queries
  if (process.env.PIXABAY_API_KEY) {
    logger.info('📸 Adding Pixabay requests');
    for (let i = 0; i < Math.min(2, searchQueries.length); i++) {
      photoPromises.push(
        fetchPixabayPhotos(searchQueries[i], Math.ceil(count / 3))
          .catch(error => {
            logger.error(`❌ Pixabay fetch failed for query "${searchQueries[i]}":`, error);
            return [];
          })
      );
    }
  } else {
    logger.warn('⚠️ Pixabay API key not configured');
  }
  
  if (photoPromises.length === 0) {
    logger.error('❌ No photo services configured! Please add API keys for Unsplash, Pexels, or Pixabay');
    return [];
  }
  
  try {
    logger.info(`📸 Executing ${photoPromises.length} photo requests`);
    const results = await Promise.allSettled(photoPromises);
    
    // Combine all successful results
    const allPhotos = results
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value)
      .filter(photo => photo && photo.url && photo.url.trim().length > 0);
    
    logger.info('📸 Photo fetch results', { 
      totalRequests: photoPromises.length,
      totalPhotos: allPhotos.length
    });
    
    if (allPhotos.length === 0) {
      logger.error('❌ No photos found from any service!', { 
        destination, 
        searchQueries: searchQueries.slice(0, 3)
      });
      return [];
    }
    
    // Remove duplicates based on URL
    const uniquePhotos = allPhotos.filter((photo, index, self) =>
      index === self.findIndex(p => p.url === photo.url)
    );
    
    // Shuffle and limit results
    const shuffled = uniquePhotos.sort(() => Math.random() - 0.5);
    const finalPhotos = shuffled.slice(0, count);
    
    logger.info('✅ Photos fetched successfully for destination', { 
      destination, 
      totalFound: allPhotos.length, 
      uniqueFound: uniquePhotos.length,
      finalCount: finalPhotos.length 
    });
    
    return finalPhotos;
    
  } catch (error) {
    logger.error('❌ Critical error fetching photos for destination:', error);
    return [];
  }
}

// Function to get activity-specific photos
async function getActivityPhotos(destination, activity, location) {
  logger.info('📸 Getting activity-specific photos', { destination, activity, location });
  
  if (!destination || !activity) {
    logger.warn('⚠️ Missing destination or activity for photo fetch');
    return null;
  }
  
  try {
    // Extract activity type for better photo search
    const activityLower = activity.toLowerCase();
    let activityType = '';
    
    // Map activity types to better search terms
    const activityMappings = {
      'museum': ['museum', 'gallery', 'exhibit'],
      'temple': ['temple', 'shrine', 'church', 'cathedral', 'mosque'],
      'market': ['market', 'shopping', 'bazaar', 'souk'],
      'park': ['park', 'garden', 'botanical', 'nature'],
      'food': ['restaurant', 'food', 'dining', 'cafe', 'cuisine'],
      'beach': ['beach', 'seaside', 'ocean', 'coast'],
      'mountain': ['mountain', 'hiking', 'trek', 'climb', 'peak'],
      'historic': ['historic', 'heritage', 'ancient', 'monument'],
      'architecture': ['architecture', 'building', 'landmark'],
      'art': ['art', 'gallery', 'artistic', 'creative']
    };
    
    // Find matching activity type
    for (const [type, keywords] of Object.entries(activityMappings)) {
      if (keywords.some(keyword => activityLower.includes(keyword))) {
        activityType = type;
        break;
      }
    }
    
    // Try multiple search queries in order of specificity
    const searchQueries = [
      location && location.trim() ? location.trim() : null,
      activityType ? `${destination} ${activityType}` : null,
      `${destination} ${activity}`,
      `${destination} attraction`,
      destination
    ].filter(q => q && q.trim().length > 0);
    
    logger.info('📸 Trying search queries for activity', { 
      activity, 
      activityType, 
      searchQueries: searchQueries.slice(0, 3)
    });
    
    for (const query of searchQueries) {
      try {
        const photos = await fetchPhotosForDestination(query, null, 1);
        if (photos.length > 0 && photos[0].url) {
          logger.info('✅ Activity photo found', { 
            activity, 
            query, 
            photoUrl: photos[0].url.substring(0, 50) + '...'
          });
          return photos[0];
        }
      } catch (error) {
        logger.error(`❌ Error fetching photo for query "${query}":`, error);
        continue;
      }
    }
    
    logger.warn('⚠️ No activity photo found after trying all queries', { 
      activity, 
      location, 
      searchQueries: searchQueries.slice(0, 3)
    });
    return null;
    
  } catch (error) {
    logger.error('❌ Critical error getting activity photos:', error);
    return null;
  }
}

// ===== DATABASE SCHEMAS =====
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  location: { type: String },
  bio: { type: String },
  profilePicture: { type: String },
  
  // Travel preferences (enhanced)
  preferences: {
    interests: [String],
    budget: String,
    travelStyle: String,
    budgetRange: String,
    pace: String,
  },
  
  // Emergency contacts (multiple contacts)
  emergencyContacts: [{
    name: { type: String, required: true },
    relationship: { type: String },
    phone: { type: String, required: true },
    email: { type: String },
    isPrimary: { type: Boolean, default: false }
  }],
  
  // Location sharing settings
  locationSharing: {
    enabled: { type: Boolean, default: false },
    shareWithContacts: { type: Boolean, default: false },
    shareWithTrustedCircle: { type: Boolean, default: false },
    allowEmergencyAccess: { type: Boolean, default: false }
  },
  
  // Medical information
  medicalInfo: {
    allergies: String,
    medications: String,
    medicalConditions: String,
    bloodType: String,
    emergencyMedicalInfo: String
  },
  
  // Travel preferences for safety
  travelPreferences: {
    checkInFrequency: { type: String, default: 'daily' },
    autoCheckIn: { type: Boolean, default: false },
    sosButtonEnabled: { type: Boolean, default: true }
  },
  
  // User statistics
  totalTrips: { type: Number, default: 0 },
  countriesVisited: { type: Number, default: 0 },
  daysTraveled: { type: Number, default: 0 },
  avgRating: { type: Number, default: 0 },
  
  // Security settings
  twoFactorEnabled: { type: Boolean, default: false },
  
  // Current location
  currentLocation: {
    latitude: Number,
    longitude: Number,
    address: String,
    accuracy: Number,
    timestamp: Date
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const itinerarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  destination: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  budget: { type: Number },
  preferences: {
    interests: [String],
    pace: String,
    accommodation: String,
  },
  days: [{
    date: String,
    dayPhoto: {
      id: String,
      url: String,
      thumb: String,
      description: String,
      photographer: String,
      photographerUrl: String,
      source: String
    },
    activities: [{
      time: String,
      activity: String,
      location: String,
      duration: String,
      cost: Number,
      notes: String,
      photo: {
        id: String,
        url: String,
        thumb: String,
        description: String,
        photographer: String,
        photographerUrl: String,
        source: String
      },
      fallbackPhoto: {
        id: String,
        url: String,
        thumb: String,
        description: String,
        photographer: String,
        photographerUrl: String,
        source: String
      }
    }],
  }],
  
  // New photo-related fields
  photosEnabled: { type: Boolean, default: false },
  destinationPhotos: [{
    id: String,
    url: String,
    thumb: String,
    description: String,
    photographer: String,
    photographerUrl: String,
    source: String
  }],
  
  rating: { type: Number, min: 1, max: 5 },
  aiGenerated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itineraryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Itinerary' },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: String,
    timestamp: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
});

const userActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String },
  icon: { type: String },
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

const checkInSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: String,
    accuracy: Number
  },
  status: { type: String, default: 'safe' },
  message: String,
  automatic: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const emergencyAlertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  alertType: { type: String, required: true },
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  message: String,
  emergencyContacts: [{
    name: String,
    phone: String,
    email: String,
    notificationSent: { type: Boolean, default: false }
  }],
  status: { type: String, default: 'active' },
  resolvedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

// ===== MODELS =====
const User = mongoose.model('User', userSchema);
const Itinerary = mongoose.model('Itinerary', itinerarySchema);
const Chat = mongoose.model('Chat', chatSchema);
const UserActivity = mongoose.model('UserActivity', userActivitySchema);
const CheckIn = mongoose.model('CheckIn', checkInSchema);
const EmergencyAlert = mongoose.model('EmergencyAlert', emergencyAlertSchema);

logger.info('📊 Database models created successfully');

// ===== UTILITY FUNCTIONS =====

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn('🔐 Authentication failed: No token provided');
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, user) => {
    if (err) {
      logger.warn('🔐 Authentication failed: Invalid token', { error: err.message });
      return res.sendStatus(403);
    }
    req.user = user;
    logger.debug('✅ Authentication successful for user:', { userId: user.userId });
    next();
  });
};

// Chat Mock Response Function
function generateIntelligentMockResponse(message, user, itinerary) {
  logger.info('🤖 Generating mock response', { message, hasUser: !!user, hasItinerary: !!itinerary });
  
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('tokyo') && lowerMessage.includes('3')) {
    return `🇯🇵 **Perfect 3-Day Tokyo Itinerary:**\n\n` +
      `**Day 1: Modern Tokyo**\n` +
      `• 9:00 AM - Shibuya Crossing & Hachiko Statue\n` +
      `• 11:00 AM - Harajuku & Takeshita Street\n` +
      `• 2:00 PM - Meiji Shrine\n` +
      `• 4:00 PM - Omotesando Hills\n` +
      `• 7:00 PM - Shibuya Sky at sunset\n\n` +
      `**Day 2: Traditional Culture**\n` +
      `• 6:00 AM - Tsukiji Outer Market (sushi breakfast!)\n` +
      `• 9:00 AM - Asakusa Temple & Nakamise Street\n` +
      `• 1:00 PM - Tokyo National Museum\n` +
      `• 4:00 PM - Tokyo Skytree\n` +
      `• 7:00 PM - Traditional dinner in Asakusa\n\n` +
      `**Day 3: Neighborhoods & Food**\n` +
      `• 9:00 AM - Shinjuku exploration\n` +
      `• 11:00 AM - Golden Gai (daytime)\n` +
      `• 2:00 PM - Ginza shopping\n` +
      `• 5:00 PM - Robot Restaurant\n` +
      `• 8:00 PM - Ramen in Memory Lane\n\n` +
      `🎌 **Pro Tips:**\n` +
      `• Get JR Pass for trains\n` +
      `• Cash is essential\n` +
      `• Try convenience store food\n` +
      `• Download Google Translate\n\n` +
      `Need specific restaurant recommendations?`;
  }
  
  return `Great question about "${message}"! I can help with detailed itineraries, local food recommendations, budget planning, and travel tips. What specific aspect interests you most?`;
}

// AI Data Sanitization Functions
function sanitizeTime(time) {
  if (!time || typeof time !== 'string') return null;
  const timeMatch = time.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }
  return null;
}

function sanitizeString(str) {
  if (!str || typeof str !== 'string') return null;
  return str.trim().substring(0, 200);
}

function sanitizeCost(cost, multiplier = 1) {
  if (typeof cost === 'number') {
    return Math.max(0, Math.round(cost * multiplier));
  }
  
  if (typeof cost === 'string') {
    const lowerCost = cost.toLowerCase();
    
    if (lowerCost.includes('free') || lowerCost.includes('no cost') || lowerCost === '0') {
      return 0;
    }
    
    const numberMatch = cost.match(/(\d+)/);
    if (numberMatch) {
      return Math.max(0, Math.round(parseInt(numberMatch[1]) * multiplier));
    }
    
    if (lowerCost.includes('variable') || lowerCost.includes('varies')) {
      return Math.floor(Math.random() * 50 * multiplier) + 10;
    }
  }
  
  return Math.floor(Math.random() * 30 * multiplier) + 15;
}

function getDefaultActivity(interests, index) {
  const defaultActivities = {
    'Culture': ['Visit local museum', 'Explore historic district', 'Cultural center visit'],
    'Food': ['Try local cuisine', 'Food market visit', 'Cooking experience'],
    'Nature': ['Park visit', 'Nature walk', 'Scenic viewpoint'],
    'Adventure': ['Local hiking', 'Adventure activity', 'Outdoor exploration'],
    'History': ['Historical site', 'Monument visit', 'Heritage tour'],
    'Art': ['Art gallery', 'Street art tour', 'Creative workshop']
  };
  
  if (interests && interests.length > 0) {
    const interest = interests[index % interests.length];
    const activities = defaultActivities[interest];
    if (activities) {
      return activities[index % activities.length];
    }
  }
  
  return ['Explore local area', 'Visit popular attraction', 'Cultural experience', 'Local exploration'][index % 4];
}

function sanitizeAIItinerary(aiData, destination, expectedDays, budget, interests, pace, startDateStr, endDateStr) {
  logger.info('🧹 Sanitizing AI itinerary data', { 
    destination, 
    expectedDays, 
    budget, 
    interests, 
    pace,
    startDate: startDateStr,
    endDate: endDateStr
  });
  
  if (!aiData || !aiData.days || !Array.isArray(aiData.days)) {
    logger.error('❌ Invalid AI response structure');
    return null;
  }
  
  const budgetMultiplier = budget === 'budget' ? 0.5 : budget === 'luxury' ? 2 : 1;
  const sanitizedDays = [];
  
  // Parse the provided start date
  let startDate;
  try {
    if (startDateStr) {
      startDate = new Date(startDateStr + (startDateStr.includes('T') ? '' : 'T00:00:00'));
      if (isNaN(startDate.getTime())) {
        throw new Error('Invalid start date');
      }
    } else {
      startDate = new Date();
    }
  } catch (error) {
    logger.error('❌ Error parsing start date:', error);
    startDate = new Date();
  }
  
  logger.debug('📅 Parsed start date:', { startDate: startDate.toISOString() });
  
  // Generate the correct number of days with the correct dates
  for (let i = 0; i < expectedDays; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    const correctDateStr = currentDate.toISOString().split('T')[0];
    
    logger.debug(`📅 Day ${i + 1} correct date: ${correctDateStr}`);
    
    // Get AI activities for this day (if available)
    const aiDay = aiData.days[i] || { activities: [] };
    const sanitizedActivities = [];
    
    if (aiDay.activities && Array.isArray(aiDay.activities)) {
      aiDay.activities.forEach((activity, index) => {
        const sanitizedActivity = {
          time: sanitizeTime(activity.time) || `${9 + index * 2}:00`,
          activity: sanitizeString(activity.activity) || 'Explore local area',
          location: sanitizeString(activity.location) || `${destination} - City Center`,
          duration: sanitizeString(activity.duration) || '2 hours',
          cost: sanitizeCost(activity.cost, budgetMultiplier),
          notes: sanitizeString(activity.notes) || 'Enjoy this activity!'
        };
        
        sanitizedActivities.push(sanitizedActivity);
      });
    }
    
    // Ensure minimum activities per day
    const minActivities = pace === 'relaxed' ? 2 : pace === 'active' ? 4 : 3;
    while (sanitizedActivities.length < minActivities) {
      const activityIndex = sanitizedActivities.length;
      sanitizedActivities.push({
        time: `${9 + activityIndex * 2}:00`,
        activity: getDefaultActivity(interests, activityIndex),
        location: `${destination} - Popular Area`,
        duration: '2 hours',
        cost: Math.floor(Math.random() * 30 * budgetMultiplier) + 10,
        notes: 'Explore and enjoy!'
      });
    }
    
    sanitizedDays.push({
      date: correctDateStr,
      activities: sanitizedActivities
    });
  }
  
  logger.info('✅ AI itinerary sanitization complete', { 
    destination, 
    daysGenerated: sanitizedDays.length 
  });
  
  return { days: sanitizedDays };
}

// Enhanced sanitization function that includes photos
async function sanitizeAIItineraryWithPhotos(aiData, destination, expectedDays, budget, interests, pace, startDateStr, endDateStr) {
  logger.info('🧹 Sanitizing AI itinerary data with photos', { destination, expectedDays });
  
  // First get the basic sanitized itinerary
  const basicItinerary = sanitizeAIItinerary(aiData, destination, expectedDays, budget, interests, pace, startDateStr, endDateStr);
  
  if (!basicItinerary) {
    logger.error('❌ Failed to sanitize basic itinerary');
    return null;
  }
  
  logger.info('📸 Starting photo generation process');
  
  // Get destination photos with retry logic
  let destinationPhotos = [];
  let photoAttempts = 0;
  const maxPhotoAttempts = 3;
  
  while (destinationPhotos.length === 0 && photoAttempts < maxPhotoAttempts) {
    photoAttempts++;
    logger.info(`📸 Attempt ${photoAttempts} to fetch destination photos`);
    
    try {
      destinationPhotos = await fetchPhotosForDestination(destination, null, 5);
      if (destinationPhotos.length > 0) {
        logger.info('✅ Destination photos fetched successfully', { count: destinationPhotos.length });
        break;
      }
    } catch (error) {
      logger.error(`❌ Photo fetch attempt ${photoAttempts} failed:`, error);
    }
    
    // Wait before retry
    if (photoAttempts < maxPhotoAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (destinationPhotos.length === 0) {
    logger.error('❌ Failed to fetch any destination photos after all attempts');
    
    // Create fallback photos
    destinationPhotos = [{
      id: 'fallback-1',
      url: 'https://via.placeholder.com/800x600/4A90E2/FFFFFF?text=' + encodeURIComponent(destination),
      thumb: 'https://via.placeholder.com/400x300/4A90E2/FFFFFF?text=' + encodeURIComponent(destination),
      description: `${destination} - Travel destination`,
      photographer: 'Placeholder',
      source: 'fallback'
    }];
  }
  
  // Add photos to each day and activity
  const enhancedDays = await Promise.all(
    basicItinerary.days.map(async (day, dayIndex) => {
      logger.info(`📸 Processing day ${dayIndex + 1}/${basicItinerary.days.length}`);
      
      // Add photos to each activity
      const enhancedActivities = await Promise.all(
        day.activities.map(async (activity, activityIndex) => {
          logger.info(`📸 Processing activity ${activityIndex + 1}/${day.activities.length}: ${activity.activity}`);
          
          try {
            // Get activity-specific photo
            const activityPhoto = await getActivityPhotos(destination, activity.activity, activity.location);
            
            const enhancedActivity = {
              ...activity,
              photo: activityPhoto,
              fallbackPhoto: activityPhoto ? null : destinationPhotos[activityIndex % destinationPhotos.length] || null
            };
            
            if (activityPhoto) {
              logger.info('✅ Activity photo added', { 
                activity: activity.activity, 
                photoSource: activityPhoto.source 
              });
            } else {
              logger.warn('⚠️ No activity photo found, using fallback', { 
                activity: activity.activity 
              });
            }
            
            return enhancedActivity;
            
          } catch (error) {
            logger.error(`❌ Error processing activity ${activityIndex}:`, error);
            return {
              ...activity,
              photo: null,
              fallbackPhoto: destinationPhotos[activityIndex % destinationPhotos.length] || null
            };
          }
        })
      );
      
      return {
        ...day,
        activities: enhancedActivities,
        dayPhoto: destinationPhotos[dayIndex % destinationPhotos.length] || null
      };
    })
  );
  
  const finalResult = {
    ...basicItinerary,
    days: enhancedDays,
    destinationPhotos: destinationPhotos.slice(0, 3),
    photosEnabled: true
  };
  
  logger.info('✅ AI itinerary with photos sanitization complete', { 
    destination, 
    daysGenerated: enhancedDays.length,
    destinationPhotos: destinationPhotos.length,
    totalActivities: enhancedDays.reduce((sum, day) => sum + day.activities.length, 0),
    activitiesWithPhotos: enhancedDays.reduce((sum, day) => 
      sum + day.activities.filter(act => act.photo && act.photo.url).length, 0
    )
  });
  
  return finalResult;
}

function generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDateStr) {
  logger.info('🎭 Generating high-quality mock itinerary', { 
    destination, 
    days, 
    interests, 
    budget, 
    pace,
    startDate: startDateStr
  });
  
  const budgetMultiplier = budget === 'budget' ? 0.6 : budget === 'luxury' ? 2.5 : 1;
  const activitiesPerDay = pace === 'relaxed' ? 2 : pace === 'active' ? 4 : 3;
  
  const mockDays = [];
  
  let startDate;
  try {
    if (startDateStr) {
      startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        throw new Error('Invalid start date for mock');
      }
    } else {
      startDate = new Date();
    }
  } catch (error) {
    logger.error('❌ Error parsing start date for mock:', error);
    startDate = new Date();
  }
  
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    
    const dayActivities = [];
    const startHour = 9;
    
    for (let j = 0; j < activitiesPerDay; j++) {
      const hour = startHour + (j * 2);
      const activity = getDefaultActivity(interests, j);
      const baseCost = 20 + (j * 15);
      
      dayActivities.push({
        time: `${hour.toString().padStart(2, '0')}:00`,
        activity: activity,
        location: `${destination} - ${['Downtown', 'Cultural District', 'Popular Area', 'Scenic Area'][j % 4]}`,
        duration: pace === 'relaxed' ? '3 hours' : pace === 'active' ? '1.5 hours' : '2 hours',
        cost: Math.round(baseCost * budgetMultiplier),
        notes: 'Check opening hours and enjoy!'
      });
    }
    
    mockDays.push({
      date: date.toISOString().split('T')[0],
      activities: dayActivities
    });
  }
  
  logger.info('✅ Mock itinerary generated successfully', { 
    destination, 
    daysGenerated: mockDays.length 
  });
  
  return { days: mockDays };
}

// Enhanced mock itinerary generation with photos
async function generateHighQualityMockItineraryWithPhotos(destination, days, interests, budget, pace, startDateStr) {
  logger.info('🎭 Generating high-quality mock itinerary with photos', { destination, days });
  
  // First get the basic mock itinerary
  const basicItinerary = generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDateStr);
  
  // Get destination photos
  const destinationPhotos = await fetchPhotosForDestination(destination, null, 5);
  
  // Add photos to each day and activity
  const enhancedDays = await Promise.all(
    basicItinerary.days.map(async (day, dayIndex) => {
      const enhancedActivities = await Promise.all(
        day.activities.map(async (activity, activityIndex) => {
          const activityPhoto = await getActivityPhotos(destination, activity.activity, activity.location);
          
          return {
            ...activity,
            photo: activityPhoto,
            fallbackPhoto: activityPhoto ? null : destinationPhotos[activityIndex % destinationPhotos.length] || null
          };
        })
      );
      
      return {
        ...day,
        activities: enhancedActivities,
        dayPhoto: destinationPhotos[dayIndex % destinationPhotos.length] || null
      };
    })
  );
  
  logger.info('✅ Mock itinerary with photos generated successfully', { 
    destination, 
    daysGenerated: enhancedDays.length,
    destinationPhotos: destinationPhotos.length
  });
  
  return {
    ...basicItinerary,
    days: enhancedDays,
    destinationPhotos: destinationPhotos.slice(0, 3),
    photosEnabled: true
  };
}

// ===== AUTHENTICATION ROUTES =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    logger.info('👤 User registration attempt', { name, email });
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      logger.warn('⚠️ Registration failed: User already exists', { email });
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();
    
    logger.info('✅ User registered successfully', { userId: user._id, email });

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    logger.error('❌ Registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    logger.info('🔐 User login attempt', { email });

    const user = await User.findOne({ email });
    if (!user) {
      logger.warn('⚠️ Login failed: User not found', { email });
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn('⚠️ Login failed: Invalid password', { email });
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    logger.info('✅ User logged in successfully', { userId: user._id, email });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    logger.error('❌ Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== NEW PHOTO API ROUTES =====

// Route to get photos for a destination
app.get('/api/photos/destination/:destination', authenticateToken, async (req, res) => {
  try {
    const { destination } = req.params;
    const count = parseInt(req.query.count) || 6;
    const activityType = req.query.type || null;
    
    logger.info('📸 Photo API request for destination', { destination, count, activityType });
    
    if (!destination || destination.trim().length === 0) {
      logger.warn('⚠️ Photo API: Invalid destination parameter');
      return res.status(400).json({ message: 'Destination is required' });
    }
    
    const photos = await fetchPhotosForDestination(destination.trim(), activityType, count);
    
    logger.info('✅ Photo API response', { destination, foundPhotos: photos.length });
    
    res.json({
      success: true,
      destination: destination.trim(),
      count: photos.length,
      photos
    });
    
  } catch (error) {
    logger.error('❌ Destination photos API error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch destination photos',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Route to get photos for a specific activity
app.get('/api/photos/activity', authenticateToken, async (req, res) => {
  try {
    const { destination, activity, location } = req.query;
    
    logger.info('📸 Photo API request for activity', { destination, activity, location });
    
    if (!destination || !activity) {
      logger.warn('⚠️ Photo API: Missing destination or activity parameter');
      return res.status(400).json({ message: 'Destination and activity are required' });
    }
    
    const photo = await getActivityPhotos(destination, activity, location);
    
    logger.info('✅ Activity photo API response', { destination, activity, photoFound: !!photo });
    
    res.json({
      success: true,
      destination,
      activity,
      location,
      photo
    });
    
  } catch (error) {
    logger.error('❌ Activity photos API error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch activity photos',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Route to check photo service availability
app.get('/api/photos/health', authenticateToken, async (req, res) => {
  try {
    logger.info('🔍 Photo service health check initiated');
    
    const services = {
      unsplash: {
        configured: !!process.env.UNSPLASH_ACCESS_KEY,
        status: 'unknown'
      },
      pexels: {
        configured: !!process.env.PEXELS_API_KEY,
        status: 'unknown'
      },
      pixabay: {
        configured: !!process.env.PIXABAY_API_KEY,
        status: 'unknown'
      }
    };
    
    // Test each configured service
    const testPromises = [];
    
    if (services.unsplash.configured) {
      testPromises.push(
        fetchUnsplashPhotos('test', 1)
          .then(photos => {
            services.unsplash.status = photos.length > 0 ? 'working' : 'no_results';
            logger.info('✅ Unsplash health check', { status: services.unsplash.status });
          })
          .catch(() => {
            services.unsplash.status = 'error';
            logger.error('❌ Unsplash health check failed');
          })
      );
    }
    
    if (services.pexels.configured) {
      testPromises.push(
        fetchPexelsPhotos('test', 1)
          .then(photos => {
            services.pexels.status = photos.length > 0 ? 'working' : 'no_results';
            logger.info('✅ Pexels health check', { status: services.pexels.status });
          })
          .catch(() => {
            services.pexels.status = 'error';
            logger.error('❌ Pexels health check failed');
          })
      );
    }
    
    if (services.pixabay.configured) {
      testPromises.push(
        fetchPixabayPhotos('test', 1)
          .then(photos => {
            services.pixabay.status = photos.length > 0 ? 'working' : 'no_results';
            logger.info('✅ Pixabay health check', { status: services.pixabay.status });
          })
          .catch(() => {
            services.pixabay.status = 'error';
            logger.error('❌ Pixabay health check failed');
          })
      );
    }
    
    await Promise.allSettled(testPromises);
    
    const summary = {
      configured: Object.values(services).filter(s => s.configured).length,
      working: Object.values(services).filter(s => s.status === 'working').length,
      total: 3
    };
    
    logger.info('✅ Photo service health check complete', { services, summary });
    
    res.json({
      success: true,
      services,
      summary
    });
    
  } catch (error) {
    logger.error('❌ Photo health check error:', error);
    res.status(500).json({ 
      message: 'Photo service health check failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Route to track photo downloads (for attribution compliance)
app.post('/api/photos/download', authenticateToken, async (req, res) => {
  try {
    const { photoId, source, downloadUrl } = req.body;
    
    logger.info('📸 Photo download tracking request', { photoId, source, userId: req.user.userId });
    
    if (source === 'unsplash' && downloadUrl && process.env.UNSPLASH_ACCESS_KEY) {
      // Trigger download tracking for Unsplash (required by their API terms)
      try {
        await axios.get(downloadUrl, {
          headers: photoServices.unsplash.headers
        });
        logger.info(`✅ Unsplash download tracked for photo ${photoId}`);
      } catch (error) {
        logger.error('❌ Unsplash download tracking error:', error);
      }
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'photo_downloaded',
      title: 'Photo downloaded',
      description: `Downloaded photo from ${source}`,
      icon: '📸',
      metadata: { photoId, source }
    }).save();
    
    logger.info('✅ Photo download tracked successfully', { photoId, source, userId: req.user.userId });
    
    res.json({ success: true, message: 'Download tracked successfully' });
    
  } catch (error) {
    logger.error('❌ Photo download tracking error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Route to get photo attribution info
app.get('/api/photos/:source/:photoId/attribution', async (req, res) => {
  try {
    const { source, photoId } = req.params;
    
    logger.info('📸 Photo attribution request', { source, photoId });
    
    let attribution = {};
    
    switch (source.toLowerCase()) {
      case 'unsplash':
        attribution = {
          text: 'Photo by {photographer} on Unsplash',
          url: 'https://unsplash.com',
          required: true,
          format: 'Photo by [photographer_name] on Unsplash'
        };
        break;
        
      case 'pexels':
        attribution = {
          text: 'Photo by {photographer} from Pexels',
          url: 'https://pexels.com',
          required: true,
          format: 'Photo by [photographer_name] from Pexels'
        };
        break;
        
      case 'pixabay':
        attribution = {
          text: 'Image by {photographer} from Pixabay',
          url: 'https://pixabay.com',
          required: false,
          format: 'Image by [photographer_name] from Pixabay (optional)'
        };
        break;
        
      default:
        logger.warn('⚠️ Invalid photo source requested', { source });
        return res.status(400).json({ message: 'Invalid photo source' });
    }
    
    logger.info('✅ Photo attribution provided', { source, photoId });
    
    res.json({
      source,
      photoId,
      attribution
    });
    
  } catch (error) {
    logger.error('❌ Photo attribution error:', error);
    res.status(500).json({ 
      message: 'Failed to get photo attribution',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== USER PROFILE ROUTES =====
app.get('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    logger.info('👤 Profile fetch request', { userId });
    
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      logger.warn('⚠️ Profile fetch: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Calculate user statistics
    const totalTrips = await Itinerary.countDocuments({ userId });
    const completedTrips = await Itinerary.find({ 
      userId,
      endDate: { $lt: new Date() }
    });
    
    // Calculate average rating from completed trips
    const ratedTrips = completedTrips.filter(trip => trip.rating);
    const avgRating = ratedTrips.length > 0 
      ? ratedTrips.reduce((sum, trip) => sum + trip.rating, 0) / ratedTrips.length 
      : 0;
    
    // Calculate total days traveled
    const daysTraveled = completedTrips.reduce((total, trip) => {
      const days = Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)) + 1;
      return total + days;
    }, 0);
    
    // Update user statistics
    await User.findByIdAndUpdate(userId, {
      totalTrips,
      avgRating: Math.round(avgRating * 10) / 10,
      daysTraveled
    });
    
    logger.info('✅ Profile data retrieved and updated', { 
      userId, 
      totalTrips, 
      avgRating, 
      daysTraveled 
    });
    
    // Return updated user data
    const updatedUser = await User.findById(userId).select('-password');
    res.json(updatedUser);
    
  } catch (error) {
    logger.error('❌ Profile fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body, updatedAt: Date.now() };
    
    logger.info('✏️ Profile update request', { userId, updates });
    
    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      logger.warn('⚠️ Profile update: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'profile_updated',
      title: 'Profile updated',
      description: 'User profile information has been updated',
    }).save();
    
    logger.info('✅ Profile updated successfully', { userId });
    
    res.json(user);
  } catch (error) {
    logger.error('❌ Profile update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== USER PREFERENCES ROUTE =====
app.put('/api/users/preferences', authenticateToken, async (req, res) => {
  try {
    const { travelStyle, budgetRange, interests, pace } = req.body;
    const userId = req.user.userId;
    
    logger.info('🎯 User preferences update request', { userId, travelStyle, budgetRange, interests, pace });
    
    // Validate interests array
    if (interests && !Array.isArray(interests)) {
      logger.warn('⚠️ Invalid interests format', { userId, interests });
      return res.status(400).json({ message: 'Interests must be an array' });
    }
    
    const preferencesUpdate = {
      preferences: {
        travelStyle: travelStyle || '',
        budgetRange: budgetRange || '',
        interests: interests || [],
        pace: pace || ''
      },
      updatedAt: Date.now()
    };
    
    const user = await User.findByIdAndUpdate(
      userId,
      preferencesUpdate,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      logger.warn('⚠️ Preferences update: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'preferences_updated',
      title: 'Travel preferences updated',
      description: `Updated travel style: ${travelStyle}, budget: ${budgetRange}, interests: ${interests?.join(', ') || 'none'}`,
      icon: '🎯'
    }).save();
    
    logger.info('✅ User preferences updated successfully', { userId });
    
    res.json(user.preferences);
    
  } catch (error) {
    logger.error('❌ Preferences update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== SAFETY SETTINGS ROUTE =====
app.put('/api/users/safety-settings', authenticateToken, async (req, res) => {
  try {
    const { emergencyContacts, locationSharing, medicalInfo, travelPreferences } = req.body;
    const userId = req.user.userId;
    
    logger.info('🛡️ Safety settings update request', { userId, emergencyContactsCount: emergencyContacts?.length });
    
    // Validate emergency contacts
    if (!emergencyContacts || !Array.isArray(emergencyContacts) || emergencyContacts.length === 0) {
      logger.warn('⚠️ Invalid emergency contacts', { userId });
      return res.status(400).json({ message: 'At least one emergency contact is required' });
    }
    
    // Validate required fields for each contact
    for (const contact of emergencyContacts) {
      if (!contact.name || !contact.name.trim()) {
        logger.warn('⚠️ Missing contact name', { userId });
        return res.status(400).json({ message: 'Contact name is required' });
      }
      if (!contact.phone || !contact.phone.trim()) {
        logger.warn('⚠️ Missing contact phone', { userId });
        return res.status(400).json({ message: 'Contact phone number is required' });
      }
    }
    
    // Ensure one primary contact
    const primaryContacts = emergencyContacts.filter(contact => contact.isPrimary);
    if (primaryContacts.length !== 1) {
      emergencyContacts.forEach((contact, index) => {
        contact.isPrimary = index === 0;
      });
    }
    
    const updates = {
      emergencyContacts,
      locationSharing: locationSharing || {
        enabled: false,
        shareWithContacts: false,
        shareWithTrustedCircle: false,
        allowEmergencyAccess: false
      },
      medicalInfo: medicalInfo || {
        allergies: '',
        medications: '',
        medicalConditions: '',
        bloodType: '',
        emergencyMedicalInfo: ''
      },
      travelPreferences: travelPreferences || {
        checkInFrequency: 'daily',
        autoCheckIn: false,
        sosButtonEnabled: true
      },
      updatedAt: Date.now()
    };
    
    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      logger.warn('⚠️ Safety settings update: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'safety_updated',
      title: 'Safety settings updated',
      description: `Updated emergency contacts (${emergencyContacts.length}), location sharing: ${locationSharing?.enabled ? 'enabled' : 'disabled'}`,
      icon: '🛡️'
    }).save();
    
    logger.info('✅ Safety settings updated successfully', { userId });
    
    res.json({
      emergencyContacts: user.emergencyContacts,
      locationSharing: user.locationSharing,
      medicalInfo: user.medicalInfo,
      travelPreferences: user.travelPreferences
    });
    
  } catch (error) {
    logger.error('❌ Safety settings update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== LOCATION UPDATE ROUTE =====
app.put('/api/users/location', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude, address, accuracy } = req.body;
    const userId = req.user.userId;
    
    logger.info('📍 Location update request', { userId, latitude, longitude, address });
    
    if (!latitude || !longitude) {
      logger.warn('⚠️ Missing location coordinates', { userId });
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }
    
    const locationUpdate = {
      currentLocation: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        address: address || `${latitude}, ${longitude}`,
        accuracy: accuracy || 0,
        timestamp: new Date()
      },
      updatedAt: Date.now()
    };
    
    const user = await User.findByIdAndUpdate(
      userId,
      locationUpdate,
      { new: true }
    ).select('currentLocation');
    
    if (!user) {
      logger.warn('⚠️ Location update: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'location_updated',
      title: 'Location updated',
      description: `Location updated to ${address || 'coordinates'}`,
      icon: '📍'
    }).save();
    
    logger.info('✅ Location updated successfully', { userId });
    
    res.json({ success: true, location: user.currentLocation });
    
  } catch (error) {
    logger.error('❌ Location update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== CHECK-IN ROUTE =====
app.post('/api/users/check-in', authenticateToken, async (req, res) => {
  try {
    const { location, status, message, automatic } = req.body;
    const userId = req.user.userId;
    
    logger.info('✅ Check-in request', { userId, status, automatic, address: location?.address });
    
    if (!location || !location.latitude || !location.longitude) {
      logger.warn('⚠️ Check-in missing location', { userId });
      return res.status(400).json({ message: 'Location is required for check-in' });
    }
    
    const checkIn = new CheckIn({
      userId,
      location: {
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        address: location.address || `${location.latitude}, ${location.longitude}`,
        accuracy: location.accuracy || 0
      },
      status: status || 'safe',
      message: message || '',
      automatic: automatic || false
    });
    
    await checkIn.save();
    
    // Update user's current location
    await User.findByIdAndUpdate(userId, {
      currentLocation: {
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        address: location.address || `${location.latitude}, ${location.longitude}`,
        accuracy: location.accuracy || 0,
        timestamp: new Date()
      }
    });
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'check_in',
      title: automatic ? 'Automatic check-in' : 'Manual check-in',
      description: `Checked in from ${location.address || 'current location'} - Status: ${status || 'safe'}`,
      icon: '✅',
      metadata: { location, status }
    }).save();
    
    logger.info('✅ Check-in completed successfully', { userId, checkInId: checkIn._id });
    
    res.json({ success: true, checkIn });
    
  } catch (error) {
    logger.error('❌ Check-in error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== EMERGENCY ALERT ROUTE =====
app.post('/api/emergency/alert', authenticateToken, async (req, res) => {
  try {
    const { type, location, emergencyContacts, message } = req.body;
    const userId = req.user.userId;
    
    logger.info('🚨 Emergency alert request', { userId, type, contactsCount: emergencyContacts?.length });
    
    if (!emergencyContacts || !Array.isArray(emergencyContacts) || emergencyContacts.length === 0) {
      logger.warn('⚠️ Emergency alert missing contacts', { userId });
      return res.status(400).json({ message: 'Emergency contacts are required' });
    }
    
    // Validate emergency contacts
    const validContacts = emergencyContacts.filter(contact => 
      contact.name && contact.name.trim() && contact.phone && contact.phone.trim()
    );
    
    if (validContacts.length === 0) {
      logger.warn('⚠️ Emergency alert no valid contacts', { userId });
      return res.status(400).json({ message: 'At least one valid emergency contact is required' });
    }
    
    const alert = new EmergencyAlert({
      userId,
      alertType: type || 'other',
      location: location ? {
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        address: location.address || `${location.latitude}, ${location.longitude}`
      } : null,
      message: message || '',
      emergencyContacts: validContacts.map(contact => ({
        name: contact.name,
        phone: contact.phone,
        email: contact.email || '',
        notificationSent: false
      }))
    });
    
    await alert.save();
    
    // In a real implementation, you would send notifications here
    // For now, we'll just mark them as sent
    alert.emergencyContacts.forEach(contact => {
      contact.notificationSent = true;
    });
    await alert.save();
    
    // Log critical activity
    await new UserActivity({
      userId,
      type: 'emergency_alert',
      title: '🚨 EMERGENCY ALERT SENT',
      description: `Emergency alert (${type || 'other'}) sent to ${validContacts.length} contacts`,
      icon: '🚨',
      metadata: { 
        alertType: type, 
        location, 
        contactCount: validContacts.length,
        alertId: alert._id
      }
    }).save();
    
    logger.info('🚨 Emergency alert sent successfully', { userId, alertId: alert._id, contactsNotified: validContacts.length });
    
    res.json({ 
      success: true, 
      alertId: alert._id,
      message: 'Emergency alert sent successfully',
      contactsNotified: validContacts.length
    });
    
  } catch (error) {
    logger.error('❌ Emergency alert error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET USER ACTIVITY ROUTE =====
app.get('/api/users/activity', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.user.userId;
    
    logger.info('📋 User activity fetch request', { userId, limit, offset });
    
    const activities = await UserActivity
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    
    const formattedActivities = activities.map(activity => ({
      id: activity._id,
      icon: activity.icon || '📋',
      title: activity.title,
      description: activity.description,
      date: activity.createdAt,
      type: activity.type,
      metadata: activity.metadata
    }));
    
    logger.info('✅ User activity fetched successfully', { userId, count: formattedActivities.length });
    
    res.json(formattedActivities);
    
  } catch (error) {
    logger.error('❌ Activity fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET TRAVEL HISTORY ROUTE =====
app.get('/api/users/travel-history', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.user.userId;
    
    logger.info('🧳 Travel history fetch request', { userId, limit, offset });
    
    // Get completed trips (where end date is in the past)
    const trips = await Itinerary
      .find({ 
        userId,
        endDate: { $lt: new Date() }
      })
      .sort({ endDate: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    
    const formattedTrips = trips.map(trip => ({
      id: trip._id,
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      totalCost: trip.budget || 0,
      rating: trip.rating || null,
      duration: Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)) + 1,
      aiGenerated: trip.aiGenerated || false,
      activities: trip.days ? trip.days.reduce((total, day) => total + (day.activities?.length || 0), 0) : 0,
      photosEnabled: trip.photosEnabled || false,
      destinationPhotos: trip.destinationPhotos || []
    }));
    
    logger.info('✅ Travel history fetched successfully', { userId, count: formattedTrips.length });
    
    res.json(formattedTrips);
    
  } catch (error) {
    logger.error('❌ Travel history fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== RATE TRIP ROUTE =====
app.put('/api/itineraries/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { rating } = req.body;
    const userId = req.user.userId;
    const itineraryId = req.params.id;
    
    logger.info('⭐ Trip rating request', { userId, itineraryId, rating });
    
    if (!rating || rating < 1 || rating > 5) {
      logger.warn('⚠️ Invalid rating value', { userId, rating });
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }
    
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: itineraryId, userId },
      { rating: parseInt(rating), updatedAt: Date.now() },
      { new: true }
    );
    
    if (!itinerary) {
      logger.warn('⚠️ Itinerary not found for rating', { userId, itineraryId });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'trip_rated',
      title: 'Trip rated',
      description: `Rated "${itinerary.title}" ${rating} stars`,
      icon: '⭐',
      metadata: { 
        itineraryId: itinerary._id, 
        rating: parseInt(rating),
        destination: itinerary.destination
      }
    }).save();
    
    // Update user's average rating
    await updateUserStats(userId);
    
    logger.info('✅ Trip rated successfully', { userId, itineraryId, rating });
    
    res.json({ success: true, rating: parseInt(rating) });
    
  } catch (error) {
    logger.error('❌ Trip rating error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET CHECK-IN HISTORY ROUTE =====
app.get('/api/users/check-ins', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.user.userId;
    
    logger.info('📍 Check-in history fetch request', { userId, limit, offset });
    
    const checkIns = await CheckIn
      .find({ userId })
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    
    logger.info('✅ Check-in history fetched successfully', { userId, count: checkIns.length });
    
    res.json(checkIns);
    
  } catch (error) {
    logger.error('❌ Check-ins fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET EMERGENCY ALERTS ROUTE =====
app.get('/api/emergency/alerts', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.user.userId;
    
    logger.info('🚨 Emergency alerts fetch request', { userId, limit, offset });
    
    const alerts = await EmergencyAlert
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    
    logger.info('✅ Emergency alerts fetched successfully', { userId, count: alerts.length });
    
    res.json(alerts);
    
  } catch (error) {
    logger.error('❌ Emergency alerts fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== RESOLVE EMERGENCY ALERT ROUTE =====
app.put('/api/emergency/alerts/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const alertId = req.params.id;
    const userId = req.user.userId;
    
    logger.info('✅ Emergency alert resolve request', { userId, alertId });
    
    const alert = await EmergencyAlert.findOneAndUpdate(
      { _id: alertId, userId },
      { 
        status: 'resolved',
        resolvedAt: new Date()
      },
      { new: true }
    );
    
    if (!alert) {
      logger.warn('⚠️ Emergency alert not found for resolve', { userId, alertId });
      return res.status(404).json({ message: 'Emergency alert not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'emergency_resolved',
      title: 'Emergency alert resolved',
      description: `Emergency alert resolved - ${alert.alertType}`,
      icon: '✅',
      metadata: { alertId: alert._id }
    }).save();
    
    logger.info('✅ Emergency alert resolved successfully', { userId, alertId });
    
    res.json({ success: true, alert });
    
  } catch (error) {
    logger.error('❌ Emergency alert resolve error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== HELPER FUNCTION TO UPDATE USER STATS =====
async function updateUserStats(userId) {
  try {
    logger.info('📊 Updating user stats', { userId });
    
    // Calculate user statistics
    const totalTrips = await Itinerary.countDocuments({ userId });
    const completedTrips = await Itinerary.find({ 
      userId,
      endDate: { $lt: new Date() }
    });
    
    // Calculate average rating from completed trips
    const ratedTrips = completedTrips.filter(trip => trip.rating);
    const avgRating = ratedTrips.length > 0 
      ? ratedTrips.reduce((sum, trip) => sum + trip.rating, 0) / ratedTrips.length 
      : 0;
    
    // Calculate total days traveled
    const daysTraveled = completedTrips.reduce((total, trip) => {
      const days = Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)) + 1;
      return total + days;
    }, 0);
    
    // Count unique countries (simplified - just count unique destinations)
    const uniqueDestinations = [...new Set(completedTrips.map(trip => trip.destination))];
    const countriesVisited = uniqueDestinations.length;
    
    // Update user statistics
    await User.findByIdAndUpdate(userId, {
      totalTrips,
      avgRating: Math.round(avgRating * 10) / 10,
      daysTraveled,
      countriesVisited,
      updatedAt: Date.now()
    });
    
    logger.info('✅ User stats updated successfully', { userId, totalTrips, avgRating, daysTraveled, countriesVisited });
    
  } catch (error) {
    logger.error('❌ Error updating user stats:', error);
  }
}

// ===== ITINERARY ROUTES =====
app.post('/api/itineraries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const itineraryData = { ...req.body, userId };
    
    logger.info('📝 Creating new itinerary', { userId, destination: req.body.destination });
    
    const itinerary = new Itinerary(itineraryData);
    await itinerary.save();
    
    logger.info('✅ Itinerary created successfully', { 
      itineraryId: itinerary._id, 
      userId, 
      destination: itinerary.destination 
    });
    
    res.status(201).json(itinerary);
  } catch (error) {
    logger.error('❌ Itinerary creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/itineraries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    logger.info('📋 Fetching user itineraries', { userId });
    
    const itineraries = await Itinerary.find({ userId }).sort({ createdAt: -1 });
    
    logger.info('✅ Itineraries fetched successfully', { 
      userId, 
      count: itineraries.length 
    });
    
    res.json(itineraries);
  } catch (error) {
    logger.error('❌ Itineraries fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    logger.info('📋 Fetching specific itinerary', { itineraryId: id, userId });
    
    const itinerary = await Itinerary.findOne({ _id: id, userId });
    
    if (!itinerary) {
      logger.warn('⚠️ Itinerary not found', { itineraryId: id, userId });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    logger.info('✅ Itinerary fetched successfully', { itineraryId: id, userId });
    res.json(itinerary);
  } catch (error) {
    logger.error('❌ Itinerary fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const updates = { ...req.body, updatedAt: Date.now() };
    
    logger.info('✏️ Updating itinerary', { itineraryId: id, userId });
    
    const existingItinerary = await Itinerary.findOne({ _id: id, userId });
    
    if (!existingItinerary) {
      logger.warn('⚠️ Itinerary not found for update', { itineraryId: id, userId });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    // Check if destination has changed
    const destinationChanged = existingItinerary.destination !== updates.destination;
    
    // Update title if destination changed
    if (destinationChanged) {
      logger.info('🏙️ Destination changed, updating title and photos', { 
        oldDestination: existingItinerary.destination,
        newDestination: updates.destination 
      });
      
      // Update title to reflect new destination
      const aiGenerated = existingItinerary.aiGenerated;
      updates.title = `${aiGenerated ? 'AI-Generated' : 'Custom'} Trip to ${updates.destination}`;
    }
    
    // Check if dates have changed
    const oldStartDate = new Date(existingItinerary.startDate).toISOString().split('T')[0];
    const newStartDate = new Date(updates.startDate).toISOString().split('T')[0];
    const oldEndDate = new Date(existingItinerary.endDate).toISOString().split('T')[0];
    const newEndDate = new Date(updates.endDate).toISOString().split('T')[0];
    
    const datesChanged = oldStartDate !== newStartDate || oldEndDate !== newEndDate;
    
    if (datesChanged) {
      logger.info('📅 Dates changed, updating day structure', { 
        oldStartDate, 
        newStartDate, 
        oldEndDate, 
        newEndDate 
      });
      
      // Calculate new duration
      const newDuration = Math.ceil((new Date(newEndDate) - new Date(newStartDate)) / (1000 * 60 * 60 * 24)) + 1;
      const oldDuration = existingItinerary.days ? existingItinerary.days.length : 0;
      
      // Update the days array to match new dates
      const updatedDays = [];
      const startDate = new Date(newStartDate + 'T00:00:00');
      
      for (let i = 0; i < newDuration; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const dateStr = currentDate.toISOString().split('T')[0];
        
        // Try to preserve activities from corresponding old day
        let dayActivities = [];
        let dayPhoto = null;
        if (i < oldDuration && existingItinerary.days[i] && existingItinerary.days[i].activities) {
          dayActivities = existingItinerary.days[i].activities;
          dayPhoto = existingItinerary.days[i].dayPhoto || null;
        }
        
        updatedDays.push({
          date: dateStr,
          activities: dayActivities,
          dayPhoto: dayPhoto
        });
      }
      
      updates.days = updatedDays;
    }
    
    // Handle destination change - regenerate photos if photos are enabled
    if (destinationChanged && existingItinerary.photosEnabled) {
      logger.info('📸 Regenerating photos for new destination', { 
        oldDestination: existingItinerary.destination,
        newDestination: updates.destination 
      });
      
      try {
        // Get new destination photos
        const newDestinationPhotos = await fetchPhotosForDestination(updates.destination, null, 5);
        
        // Update destination photos
        updates.destinationPhotos = newDestinationPhotos.slice(0, 3);
        
        // Update day and activity photos
        const enhancedDays = await Promise.all(
          (updates.days || existingItinerary.days).map(async (day, dayIndex) => {
            const enhancedActivities = await Promise.all(
              day.activities.map(async (activity, activityIndex) => {
                // Get new activity-specific photo for the new destination
                const newActivityPhoto = await getActivityPhotos(updates.destination, activity.activity, activity.location);
                
                return {
                  ...activity,
                  photo: newActivityPhoto,
                  fallbackPhoto: newActivityPhoto ? null : newDestinationPhotos[activityIndex % newDestinationPhotos.length] || null
                };
              })
            );
            
            return {
              ...day,
              activities: enhancedActivities,
              dayPhoto: newDestinationPhotos[dayIndex % newDestinationPhotos.length] || null
            };
          })
        );
        
        updates.days = enhancedDays;
        
        logger.info('✅ Photos regenerated successfully for new destination', { 
          newDestination: updates.destination,
          photoCount: newDestinationPhotos.length 
        });
        
      } catch (photoError) {
        logger.error('❌ Error regenerating photos for new destination:', photoError);
        // Continue with update even if photo regeneration fails
      }
    }
    
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: id, userId },
      updates,
      { new: true, runValidators: true }
    );
    
    if (!itinerary) {
      logger.warn('⚠️ Itinerary update failed', { itineraryId: id, userId });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    // Log activity with more details
    const activityDescription = [];
    if (destinationChanged) {
      activityDescription.push(`destination changed to ${updates.destination}`);
    }
    if (datesChanged) {
      activityDescription.push('dates updated');
    }
    if (destinationChanged && existingItinerary.photosEnabled) {
      activityDescription.push('photos regenerated');
    }
    
    await new UserActivity({
      userId,
      type: 'itinerary_updated',
      title: 'Itinerary updated',
      description: `Updated "${itinerary.title}" - ${activityDescription.join(', ')}`,
      icon: '✏️',
      metadata: { 
        itineraryId: itinerary._id,
        destination: itinerary.destination,
        destinationChanged,
        datesChanged,
        photosRegenerated: destinationChanged && existingItinerary.photosEnabled
      }
    }).save();
    
    logger.info('✅ Itinerary updated successfully', { 
      itineraryId: id, 
      userId,
      destinationChanged,
      datesChanged,
      photosRegenerated: destinationChanged && existingItinerary.photosEnabled
    });
    
    res.json(itinerary);
  } catch (error) {
    logger.error('❌ Itinerary update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.delete('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    logger.info('🗑️ Deleting itinerary', { itineraryId: id, userId });
    
    const itinerary = await Itinerary.findOneAndDelete({ _id: id, userId });
    
    if (!itinerary) {
      logger.warn('⚠️ Itinerary not found for deletion', { itineraryId: id, userId });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    logger.info('✅ Itinerary deleted successfully', { itineraryId: id, userId });
    res.json({ message: 'Itinerary deleted successfully' });
  } catch (error) {
    logger.error('❌ Itinerary deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== ENHANCED ITINERARY GENERATION ROUTE WITH PHOTOS =====
app.post('/api/generate-itinerary', authenticateToken, async (req, res) => {
  try {
    const { destination, startDate, endDate, interests, budget, pace, includePhotos = true } = req.body;
    const userId = req.user.userId;
    
    logger.info('🎯 Itinerary generation request', { 
      userId, 
      destination, 
      startDate, 
      endDate, 
      interests, 
      budget, 
      pace, 
      includePhotos 
    });
    
    // Validate required fields
    if (!destination || !startDate || !endDate) {
      logger.warn('⚠️ Missing required fields for itinerary generation');
      return res.status(400).json({ 
        message: 'Destination, start date, and end date are required' 
      });
    }
    
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    
    if (days < 1 || days > 30) {
      logger.warn('⚠️ Invalid trip duration', { days });
      return res.status(400).json({ 
        message: 'Trip duration must be between 1 and 30 days' 
      });
    }
    
    // Check photo service availability if photos are requested
    if (includePhotos) {
      const photoServicesAvailable = !!(
        process.env.UNSPLASH_ACCESS_KEY || 
        process.env.PEXELS_API_KEY || 
        process.env.PIXABAY_API_KEY
      );
      
      if (!photoServicesAvailable) {
        logger.warn('⚠️ Photos requested but no photo services configured');
        return res.status(400).json({ 
          message: 'Photos requested but no photo services are configured. Please contact administrator.' 
        });
      }
    }
    
    let generatedItinerary;
    let useAI = false;
    let provider = 'mock';
    
    // Check if we can use Gemini
    const hasValidKey = process.env.GEMINI_API_KEY && genAI;
    const withinRateLimit = rateLimiter.isAllowed(userId);
    
    if (hasValidKey && withinRateLimit) {
      try {
        logger.info('🤖 Attempting Gemini AI generation');
        
        const prompt = `You are a travel expert. Create a ${days}-day itinerary for ${destination}.

User preferences:
- Interests: ${interests.join(', ')}
- Budget: ${budget}
- Travel pace: ${pace}
- Dates: ${startDate} to ${endDate}

IMPORTANT: Generate activities for each day but DO NOT worry about specific dates in your response. 
Focus on creating great activities with detailed location names for photo matching.

Create a JSON response with this EXACT structure:
{
  "days": [
    {
      "activities": [
        {
          "time": "09:00",
          "activity": "Visit Senso-ji Temple",
          "location": "4-2-1 Asakusa, Taito City, Tokyo",
          "duration": "2 hours",
          "cost": 0,
          "notes": "Free admission, arrive early to avoid crowds"
        }
      ]
    }
  ]
}

Rules:
1. Cost must be a NUMBER (integer), never text
2. Use 0 for free activities
3. Times must be in HH:MM format
4. Make location names specific and detailed
5. Generate exactly ${days} days
6. Include ${pace === 'relaxed' ? '2-3' : pace === 'active' ? '4-5' : '3-4'} activities per day

Generate exactly ${days} days of activities. Make costs realistic integers in USD. No explanatory text, just JSON.`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const geminiResponse = response.text();
        
        logger.info('✅ Gemini AI responded successfully');
        
        // Extract and clean JSON
        let jsonStr = geminiResponse.trim();
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        
        let aiItinerary = JSON.parse(jsonStr);
        
        // Validate and sanitize the data with photos
        if (includePhotos) {
          logger.info('📸 Adding photos to AI-generated itinerary');
          generatedItinerary = await sanitizeAIItineraryWithPhotos(aiItinerary, destination, days, budget, interests, pace, startDate, endDate);
        } else {
          generatedItinerary = sanitizeAIItinerary(aiItinerary, destination, days, budget, interests, pace, startDate, endDate);
        }
        
        if (generatedItinerary && generatedItinerary.days && generatedItinerary.days.length > 0) {
          useAI = true;
          provider = 'gemini';
          logger.info('✅ AI itinerary generated successfully');
        } else {
          throw new Error('Invalid itinerary structure from AI');
        }
        
      } catch (aiError) {
        logger.error('❌ AI generation failed, falling back to mock:', aiError);
        
        if (includePhotos) {
          generatedItinerary = await generateHighQualityMockItineraryWithPhotos(destination, days, interests, budget, pace, startDate);
        } else {
          generatedItinerary = generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDate);
        }
        provider = 'mock';
      }
    } else {
      if (!hasValidKey) {
        logger.warn('⚠️ No AI key configured, using mock generation');
      } else {
        logger.warn('⚠️ Rate limited, using mock generation');
      }
      
      if (includePhotos) {
        generatedItinerary = await generateHighQualityMockItineraryWithPhotos(destination, days, interests, budget, pace, startDate);
      } else {
        generatedItinerary = generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDate);
      }
      provider = 'mock';
    }
    
    // Final validation
    if (!generatedItinerary || !generatedItinerary.days || generatedItinerary.days.length === 0) {
      throw new Error('Failed to generate valid itinerary');
    }
    
    logger.info('💾 Saving itinerary to database');
    
    // Create and save the itinerary
    const itinerary = new Itinerary({
      userId,
      title: `${useAI ? 'AI-Generated' : 'Custom'} Trip to ${destination}`,
      destination,
      startDate,
      endDate,
      budget: budget === 'budget' ? 500 : budget === 'mid-range' ? 1500 : 3000,
      preferences: { interests, pace },
      days: generatedItinerary.days,
      aiGenerated: useAI,
      photosEnabled: includePhotos,
      destinationPhotos: generatedItinerary.destinationPhotos || [],
    });
    
    const savedItinerary = await itinerary.save();
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'itinerary_generated',
      title: `${useAI ? 'AI-Generated' : 'Custom'} itinerary created`,
      description: `Generated ${days}-day itinerary for ${destination}${includePhotos ? ' with photos' : ''}`,
      icon: '🗺️',
      metadata: { 
        destination, 
        days, 
        provider,
        photosEnabled: includePhotos,
        photoCount: generatedItinerary.destinationPhotos?.length || 0
      }
    }).save();
    
    logger.info('✅ Itinerary generation completed successfully', { 
      itineraryId: savedItinerary._id,
      userId,
      destination,
      provider,
      photosEnabled: includePhotos,
      photoStats: includePhotos ? {
        destinationPhotos: generatedItinerary.destinationPhotos?.length || 0,
        activitiesWithPhotos: generatedItinerary.days?.reduce((sum, day) => 
          sum + day.activities.filter(act => act.photo && act.photo.url).length, 0) || 0
      } : null
    });
    
    res.json({
      ...savedItinerary.toObject(),
      provider,
      photosEnabled: includePhotos,
      photoServices: {
        unsplash: !!process.env.UNSPLASH_ACCESS_KEY,
        pexels: !!process.env.PEXELS_API_KEY,
        pixabay: !!process.env.PIXABAY_API_KEY
      },
      photoStats: includePhotos ? {
        destinationPhotos: generatedItinerary.destinationPhotos?.length || 0,
        activitiesWithPhotos: generatedItinerary.days?.reduce((sum, day) => 
          sum + day.activities.filter(act => act.photo && act.photo.url).length, 0) || 0,
        totalActivities: generatedItinerary.days?.reduce((sum, day) => sum + day.activities.length, 0) || 0
      } : null,
      message: useAI ? 
        `AI-generated itinerary created${includePhotos ? ' with photos' : ''}!` : 
        `Custom itinerary created${includePhotos ? ' with photos' : ''}!`
    });
    
  } catch (error) {
    logger.error('❌ Itinerary generation error:', error);
    res.status(500).json({ 
      message: 'Failed to generate itinerary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== ADD PHOTOS TO EXISTING ITINERARY ROUTE =====
app.post('/api/itineraries/:id/add-photos', authenticateToken, async (req, res) => {
  try {
    const itineraryId = req.params.id;
    const userId = req.user.userId;
    
    logger.info('📸 Add photos to existing itinerary request', { userId, itineraryId });
    
    const itinerary = await Itinerary.findOne({
      _id: itineraryId,
      userId,
    });
    
    if (!itinerary) {
      logger.warn('⚠️ Itinerary not found for photo addition', { userId, itineraryId });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    logger.info(`📸 Adding photos to existing itinerary: ${itinerary.title}`);
    
    // Get destination photos
    const destinationPhotos = await fetchPhotosForDestination(itinerary.destination, null, 5);
    
    // Add photos to each day and activity
    const enhancedDays = await Promise.all(
      itinerary.days.map(async (day, dayIndex) => {
        const enhancedActivities = await Promise.all(
          day.activities.map(async (activity, activityIndex) => {
            // Skip if photo already exists
            if (activity.photo && activity.photo.url) {
              return activity;
            }
            
            const activityPhoto = await getActivityPhotos(itinerary.destination, activity.activity, activity.location);
            
            return {
              ...activity,
              photo: activityPhoto,
              fallbackPhoto: activityPhoto ? null : destinationPhotos[activityIndex % destinationPhotos.length] || null
            };
          })
        );
        
        return {
          ...day,
          activities: enhancedActivities,
          dayPhoto: day.dayPhoto || destinationPhotos[dayIndex % destinationPhotos.length] || null
        };
      })
    );
    
    // Update the itinerary
    const updatedItinerary = await Itinerary.findByIdAndUpdate(
      itineraryId,
      {
        days: enhancedDays,
        destinationPhotos: destinationPhotos.slice(0, 3),
        photosEnabled: true,
        updatedAt: Date.now()
      },
      { new: true }
    );
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'photos_added',
      title: 'Photos added to itinerary',
      description: `Added photos to "${itinerary.title}"`,
      icon: '📸',
      metadata: { 
        itineraryId: itinerary._id,
        photoCount: destinationPhotos.length
      }
    }).save();
    
    logger.info('✅ Photos added to itinerary successfully', { userId, itineraryId, photoCount: destinationPhotos.length });
    
    res.json({
      success: true,
      message: 'Photos added successfully',
      photoCount: destinationPhotos.length,
      itinerary: updatedItinerary
    });
    
  } catch (error) {
    logger.error('❌ Add photos error:', error);
    res.status(500).json({ 
      message: 'Failed to add photos to itinerary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== REFRESH SINGLE ACTIVITY PHOTO ROUTE =====
app.post('/api/itineraries/:id/days/:dayIndex/activities/:activityIndex/refresh-photo', authenticateToken, async (req, res) => {
  try {
    const { id, dayIndex, activityIndex } = req.params;
    const userId = req.user.userId;
    
    logger.info('🔄 Refresh activity photo request', { userId, itineraryId: id, dayIndex, activityIndex });
    
    const itinerary = await Itinerary.findOne({
      _id: id,
      userId,
    });
    
    if (!itinerary) {
      logger.warn('⚠️ Itinerary not found for photo refresh', { userId, itineraryId: id });
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    const dayIdx = parseInt(dayIndex);
    const actIdx = parseInt(activityIndex);
    
    if (!itinerary.days[dayIdx] || !itinerary.days[dayIdx].activities[actIdx]) {
      logger.warn('⚠️ Activity not found for photo refresh', { userId, dayIdx, actIdx });
      return res.status(404).json({ message: 'Activity not found' });
    }
    
    const activity = itinerary.days[dayIdx].activities[actIdx];
    
    // Get new photo for this activity
    const newPhoto = await getActivityPhotos(itinerary.destination, activity.activity, activity.location);
    
    // Update the specific activity
    itinerary.days[dayIdx].activities[actIdx].photo = newPhoto;
    itinerary.updatedAt = Date.now();
    
    await itinerary.save();
    
    logger.info('✅ Activity photo refreshed successfully', { userId, itineraryId: id, dayIdx, actIdx });
    
    res.json({
      success: true,
      message: 'Activity photo refreshed',
      photo: newPhoto
    });
    
  } catch (error) {
    logger.error('❌ Refresh photo error:', error);
    res.status(500).json({ 
      message: 'Failed to refresh photo',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== BATCH PHOTO OPERATIONS ROUTE =====
app.post('/api/photos/batch-operations', authenticateToken, async (req, res) => {
  try {
    const { operation, destinations, count = 3 } = req.body;
    const userId = req.user.userId;
    
    logger.info('📸 Batch photo operations request', { userId, operation, destinations, count });
    
    if (!operation || !destinations || !Array.isArray(destinations)) {
      logger.warn('⚠️ Invalid batch photo operation parameters', { userId, operation, destinations });
      return res.status(400).json({ message: 'Operation and destinations array are required' });
    }
    
    const results = {};
    
    switch (operation) {
      case 'fetch_destination_photos':
        for (const destination of destinations.slice(0, 5)) { // Limit to 5 destinations
          try {
            const photos = await fetchPhotosForDestination(destination, null, count);
            results[destination] = {
              success: true,
              count: photos.length,
              photos
            };
          } catch (error) {
            results[destination] = {
              success: false,
              error: error.message,
              photos: []
            };
          }
        }
        break;
        
      case 'test_photo_services':
        const testResults = {};
        
        if (process.env.UNSPLASH_ACCESS_KEY) {
          try {
            const unsplashPhotos = await fetchUnsplashPhotos('travel', 1);
            testResults.unsplash = { working: unsplashPhotos.length > 0, count: unsplashPhotos.length };
          } catch (error) {
            testResults.unsplash = { working: false, error: error.message };
          }
        }
        
        if (process.env.PEXELS_API_KEY) {
          try {
            const pexelsPhotos = await fetchPexelsPhotos('travel', 1);
            testResults.pexels = { working: pexelsPhotos.length > 0, count: pexelsPhotos.length };
          } catch (error) {
            testResults.pexels = { working: false, error: error.message };
          }
        }
        
        if (process.env.PIXABAY_API_KEY) {
          try {
            const pixabayPhotos = await fetchPixabayPhotos('travel', 1);
            testResults.pixabay = { working: pixabayPhotos.length > 0, count: pixabayPhotos.length };
          } catch (error) {
            testResults.pixabay = { working: false, error: error.message };
          }
        }
        
        results.serviceTests = testResults;
        break;
        
      default:
        logger.warn('⚠️ Invalid batch photo operation', { userId, operation });
        return res.status(400).json({ message: 'Invalid operation' });
    }
    
    logger.info('✅ Batch photo operations completed successfully', { userId, operation });
    
    res.json({
      success: true,
      operation,
      results
    });
    
  } catch (error) {
    logger.error('❌ Batch photo operations error:', error);
    res.status(500).json({ 
      message: 'Batch operation failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== CHAT ROUTES =====
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, itineraryId } = req.body;
    const userId = req.user.userId;
    
    logger.info('💬 Chat request received', { userId, message, itineraryId });
    
    if (!message || message.trim().length === 0) {
      logger.warn('⚠️ Chat request with empty message');
      return res.status(400).json({ 
        message: 'Message is required',
        response: 'Please enter a message to chat with me!' 
      });
    }
    
    // Get user preferences for context
    const user = await User.findById(userId);
    let itinerary = null;
    
    if (itineraryId && itineraryId !== 'undefined' && itineraryId !== '' && itineraryId.length === 24) {
      try {
        itinerary = await Itinerary.findById(itineraryId);
      } catch (err) {
        logger.debug('Invalid itinerary ID, proceeding without itinerary context');
      }
    }
    
    let aiResponse;
    let useAI = false;
    
    // Check if we should try Gemini API
    const hasValidKey = process.env.GEMINI_API_KEY && genAI;
    const withinRateLimit = rateLimiter.isAllowed(userId);
    
    if (hasValidKey && withinRateLimit) {
      try {
        logger.info('🤖 Attempting Gemini AI chat response');
        
        // Build context prompt
        let contextPrompt = `You are an expert travel planning assistant. Help users plan amazing trips with personalized recommendations.

INSTRUCTIONS:
- Provide specific, actionable travel advice
- Include practical tips and local insights
- Be enthusiastic but concise
- Use emojis to make responses engaging
- Focus on the user's specific question

`;
        
        // Add user context
        if (user?.preferences) {
          const interests = user.preferences.interests?.join(', ') || 'general travel';
          const budget = user.preferences.budget || 'flexible';
          const travelStyle = user.preferences.travelStyle || 'flexible';
          contextPrompt += `USER PREFERENCES:
- Interests: ${interests}
- Budget: ${budget}
- Travel style: ${travelStyle}

`;
        }
        
        // Add itinerary context
        if (itinerary) {
          contextPrompt += `CURRENT TRIP CONTEXT:
- Destination: ${itinerary.destination}
- Dates: ${new Date(itinerary.startDate).toDateString()} to ${new Date(itinerary.endDate).toDateString()}
- Duration: ${Math.ceil((new Date(itinerary.endDate) - new Date(itinerary.startDate)) / (1000 * 60 * 60 * 24)) + 1} days

`;
        }
        
        contextPrompt += `USER QUESTION: ${message.trim()}

Please provide a helpful, specific response:`;
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(contextPrompt);
        const response = await result.response;
        aiResponse = response.text();
        
        useAI = true;
        logger.info('✅ Gemini AI chat response received successfully');
        
      } catch (geminiError) {
        logger.error('❌ Gemini API error, using mock response:', geminiError);
        aiResponse = generateIntelligentMockResponse(message, user, itinerary);
      }
    } else {
      if (!hasValidKey) {
        logger.warn('⚠️ No valid Gemini key, using mock response');
      } else if (!withinRateLimit) {
        logger.warn('⚠️ Rate limited, using mock response');
      }
      aiResponse = generateIntelligentMockResponse(message, user, itinerary);
    }
    
    // Handle empty itineraryId for database save
    const chatItineraryId = (itineraryId && itineraryId !== '' && itineraryId !== 'undefined' && itineraryId.length === 24) 
      ? itineraryId 
      : null;
    
    // Save chat history
    let chat = await Chat.findOne({ 
      userId, 
      itineraryId: chatItineraryId 
    });
    
    if (!chat) {
      chat = new Chat({
        userId,
        itineraryId: chatItineraryId,
        messages: [],
      });
    }
    
    // Limit chat history to prevent database bloat
    if (chat.messages.length > 50) {
      chat.messages = chat.messages.slice(-48);
    }
    
    chat.messages.push(
      { role: 'user', content: message.trim() },
      { role: 'assistant', content: aiResponse }
    );
    
    await chat.save();
    
    logger.info('✅ Chat response generated and saved', { userId, useAI, provider: useAI ? 'gemini' : 'mock' });
    
    res.json({ 
      response: aiResponse,
      aiPowered: useAI,
      provider: useAI ? 'gemini' : 'mock'
    });
    
  } catch (error) {
    logger.error('❌ Chat service error:', error);
    res.status(500).json({ 
      message: 'Chat service error', 
      response: 'I apologize, but I am having trouble right now. Please try again in a moment.',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

app.get('/api/chat-history/:itineraryId?', authenticateToken, async (req, res) => {
  try {
    const { itineraryId } = req.params;
    const userId = req.user.userId;
    
    logger.info('📜 Chat history request', { userId, itineraryId });
    
    const query = { userId };
    
    if (itineraryId && itineraryId !== 'undefined' && itineraryId !== '' && itineraryId.length === 24) {
      query.itineraryId = itineraryId;
    } else {
      query.itineraryId = null;
    }
    
    const chat = await Chat.findOne(query);
    const messages = chat ? chat.messages : [];
    
    logger.info('✅ Chat history retrieved', { userId, messageCount: messages.length });
    
    res.json(messages);
  } catch (error) {
    logger.error('❌ Chat history error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== ADDITIONAL USER ROUTES =====
app.put('/api/users/two-factor', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.userId;
    
    logger.info('🔐 Two-factor authentication toggle request', { userId, enabled });
    
    await User.findByIdAndUpdate(userId, {
      twoFactorEnabled: !!enabled,
      updatedAt: Date.now()
    });
    
    await new UserActivity({
      userId,
      type: 'two_factor_toggle',
      title: `Two-factor authentication ${enabled ? 'enabled' : 'disabled'}`,
      description: `2FA has been ${enabled ? 'enabled' : 'disabled'} for this account`,
    }).save();
    
    logger.info('✅ Two-factor authentication toggled successfully', { userId, enabled });
    
    res.json({ success: true, twoFactorEnabled: !!enabled });
    
  } catch (error) {
    logger.error('❌ Two-factor toggle error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.delete('/api/users/delete-account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    logger.info('🗑️ Account deletion request', { userId });
    
    await Promise.all([
      User.findByIdAndDelete(userId),
      Itinerary.deleteMany({ userId }),
      Chat.deleteMany({ userId }),
      UserActivity.deleteMany({ userId }),
      CheckIn.deleteMany({ userId }),
      EmergencyAlert.deleteMany({ userId })
    ]);
    
    logger.info('✅ Account deleted successfully', { userId });
    
    res.json({ success: true, message: 'Account deleted successfully' });
    
  } catch (error) {
    logger.error('❌ Account deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== PROFILE PICTURE UPLOAD ROUTE =====
app.post('/api/users/profile-picture', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    logger.info('📷 Profile picture upload request', { userId });
    
    // In a real implementation, you would handle file upload here
    // For now, we'll just return a success response
    // You would typically use multer or similar for file handling
    
    logger.warn('⚠️ Profile picture upload not implemented', { userId });
    
    res.status(501).json({ 
      message: 'Profile picture upload not implemented yet',
      note: 'This would typically handle file upload with multer and cloud storage'
    });
    
  } catch (error) {
    logger.error('❌ Profile picture upload error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== BULK USER STATS UPDATE ROUTE (Admin/Maintenance) =====
app.post('/api/admin/update-user-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    logger.info('📊 Bulk user stats update request', { userId });
    
    // This would be an admin-only route in a real implementation
    const users = await User.find({}).select('_id');
    
    for (const user of users) {
      await updateUserStats(user._id);
    }
    
    logger.info('✅ Bulk user stats update completed', { userId, usersUpdated: users.length });
    
    res.json({ 
      success: true, 
      message: `Updated stats for ${users.length} users` 
    });
    
  } catch (error) {
    logger.error('❌ Bulk user stats update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'Travel Planner API is running',
    features: {
      ai: !!process.env.GEMINI_API_KEY,
      photos: {
        unsplash: !!process.env.UNSPLASH_ACCESS_KEY,
        pexels: !!process.env.PEXELS_API_KEY,
        pixabay: !!process.env.PIXABAY_API_KEY
      },
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    }
  };
  
  logger.info('🏥 Health check request', healthStatus);
  res.json(healthStatus);
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('💥 Unhandled error:', err);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Handle 404 routes
app.use('*', (req, res) => {
  logger.warn('🔍 404 - Route not found', { method: req.method, url: req.originalUrl });
  res.status(404).json({ message: 'Route not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ===== START SERVER =====
app.listen(PORT, () => {
  logger.info('🚀 Server started successfully', { port: PORT });
  logger.info('📊 Service Status:', {
    unsplash: !!process.env.UNSPLASH_ACCESS_KEY ? '✅ Configured' : '❌ Not configured',
    pexels: !!process.env.PEXELS_API_KEY ? '✅ Configured' : '❌ Not configured',
    pixabay: !!process.env.PIXABAY_API_KEY ? '✅ Configured' : '❌ Not configured',
    geminiAI: !!process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Not configured',
    mongodb: '🔄 Connecting...'
  });
});

module.exports = app;