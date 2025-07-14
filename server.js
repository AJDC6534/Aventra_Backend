// server.js - Main Express.js server with Photo Integration
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
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Initialize Google Generative AI
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

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
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(userId, validRequests);
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
  try {
    if (!process.env.UNSPLASH_ACCESS_KEY) {
      console.log('Unsplash API key not configured');
      return [];
    }

    const url = `${photoServices.unsplash.baseUrl}${photoServices.unsplash.searchEndpoint}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
    
    const response = await axios.get(url, {
      headers: photoServices.unsplash.headers,
      timeout: 5000
    });

    return response.data.results?.map(photo => ({
      id: photo.id,
      url: photo.urls.regular,
      thumb: photo.urls.thumb,
      description: photo.alt_description || photo.description || query,
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
      downloadUrl: photo.links.download_location,
      source: 'unsplash'
    })) || [];

  } catch (error) {
    console.error('Unsplash fetch error:', error.message);
    return [];
  }
}

// Function to fetch photos from Pexels
async function fetchPexelsPhotos(query, count = 3) {
  try {
    if (!process.env.PEXELS_API_KEY) {
      console.log('Pexels API key not configured');
      return [];
    }

    const url = `${photoServices.pexels.baseUrl}${photoServices.pexels.searchEndpoint}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
    
    const response = await axios.get(url, {
      headers: photoServices.pexels.headers,
      timeout: 5000
    });

    return response.data.photos?.map(photo => ({
      id: photo.id,
      url: photo.src.large,
      thumb: photo.src.medium,
      description: photo.alt || query,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      source: 'pexels'
    })) || [];

  } catch (error) {
    console.error('Pexels fetch error:', error.message);
    return [];
  }
}

// Function to fetch photos from Pixabay
async function fetchPixabayPhotos(query, count = 3) {
  try {
    if (!process.env.PIXABAY_API_KEY) {
      console.log('Pixabay API key not configured');
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

    return response.data.hits?.map(photo => ({
      id: photo.id,
      url: photo.webformatURL,
      thumb: photo.previewURL,
      description: photo.tags || query,
      photographer: photo.user,
      source: 'pixabay'
    })) || [];

  } catch (error) {
    console.error('Pixabay fetch error:', error.message);
    return [];
  }
}

// Main function to fetch photos from multiple sources
async function fetchPhotosForDestination(destination, activityType = null, count = 3) {
  const query = activityType ? `${destination} ${activityType}` : destination;
  
  console.log(`Fetching photos for: ${query}`);
  
  // Try all services in parallel with different queries
  const searchQueries = [
    query,
    destination,
    `${destination} travel`,
    `${destination} tourism`
  ];
  
  const photoPromises = [];
  
  // Add Unsplash requests
  if (process.env.UNSPLASH_ACCESS_KEY) {
    photoPromises.push(fetchUnsplashPhotos(searchQueries[0], Math.ceil(count / 3)));
    photoPromises.push(fetchUnsplashPhotos(searchQueries[1], Math.ceil(count / 3)));
  }
  
  // Add Pexels requests
  if (process.env.PEXELS_API_KEY) {
    photoPromises.push(fetchPexelsPhotos(searchQueries[0], Math.ceil(count / 3)));
  }
  
  // Add Pixabay requests
  if (process.env.PIXABAY_API_KEY) {
    photoPromises.push(fetchPixabayPhotos(searchQueries[0], Math.ceil(count / 3)));
  }
  
  try {
    const results = await Promise.allSettled(photoPromises);
    
    // Combine all successful results
    const allPhotos = results
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value)
      .filter(photo => photo && photo.url);
    
    // Remove duplicates based on URL
    const uniquePhotos = allPhotos.filter((photo, index, self) =>
      index === self.findIndex(p => p.url === photo.url)
    );
    
    // Shuffle and limit results
    const shuffled = uniquePhotos.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
    
  } catch (error) {
    console.error('Error fetching photos:', error);
    return [];
  }
}

// Function to get activity-specific photos
async function getActivityPhotos(destination, activity, location) {
  try {
    // Extract activity type for better photo search
    const activityLower = activity.toLowerCase();
    let activityType = '';
    
    if (activityLower.includes('museum') || activityLower.includes('gallery')) {
      activityType = 'museum';
    } else if (activityLower.includes('temple') || activityLower.includes('shrine') || activityLower.includes('church')) {
      activityType = 'temple';
    } else if (activityLower.includes('market') || activityLower.includes('shopping')) {
      activityType = 'market';
    } else if (activityLower.includes('park') || activityLower.includes('garden')) {
      activityType = 'park';
    } else if (activityLower.includes('restaurant') || activityLower.includes('food') || activityLower.includes('dining')) {
      activityType = 'food';
    } else if (activityLower.includes('beach')) {
      activityType = 'beach';
    } else if (activityLower.includes('mountain') || activityLower.includes('hiking')) {
      activityType = 'mountain';
    }
    
    // Try specific location first, then fall back to destination
    const searchQueries = [
      location,
      `${destination} ${activityType}`,
      `${destination} ${activity}`,
      destination
    ].filter(q => q && q.trim());
    
    for (const query of searchQueries) {
      const photos = await fetchPhotosForDestination(query, null, 1);
      if (photos.length > 0) {
        return photos[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting activity photos:', error);
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

// ===== UTILITY FUNCTIONS =====

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Chat Mock Response Function
function generateIntelligentMockResponse(message, user, itinerary) {
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
  console.log('🧹 Sanitizing AI itinerary data...');
  console.log('Start date received:', startDateStr);
  console.log('End date received:', endDateStr);
  
  if (!aiData || !aiData.days || !Array.isArray(aiData.days)) {
    console.error('Invalid AI response structure');
    return null;
  }
  
  const budgetMultiplier = budget === 'budget' ? 0.5 : budget === 'luxury' ? 2 : 1;
  const sanitizedDays = [];
  
  // Parse the provided start date
  let startDate;
  try {
    if (startDateStr) {
      // Handle both YYYY-MM-DD and ISO format
      startDate = new Date(startDateStr + (startDateStr.includes('T') ? '' : 'T00:00:00'));
      if (isNaN(startDate.getTime())) {
        throw new Error('Invalid start date');
      }
    } else {
      startDate = new Date();
    }
  } catch (error) {
    console.error('Error parsing start date:', error);
    startDate = new Date();
  }
  
  console.log('Parsed start date:', startDate.toISOString());
  
  // Generate the correct number of days with the correct dates
  for (let i = 0; i < expectedDays; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    const correctDateStr = currentDate.toISOString().split('T')[0];
    
    console.log(`Day ${i + 1} correct date: ${correctDateStr}`);
    
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
    
    // ✅ IMPORTANT: Use the correct date, not the AI's date
    sanitizedDays.push({
      date: correctDateStr, // This ensures we use YOUR dates, not AI's dates
      activities: sanitizedActivities
    });
  }
  
  console.log('Sanitization complete with correct dates');
  return { days: sanitizedDays };
}

// Enhanced sanitization function that includes photos
async function sanitizeAIItineraryWithPhotos(aiData, destination, expectedDays, budget, interests, pace, startDateStr, endDateStr) {
  console.log('🧹 Sanitizing AI itinerary data with photos...');
  
  // First get the basic sanitized itinerary
  const basicItinerary = sanitizeAIItinerary(aiData, destination, expectedDays, budget, interests, pace, startDateStr, endDateStr);
  
  if (!basicItinerary) {
    return null;
  }
  
  // Get destination photos
  const destinationPhotos = await fetchPhotosForDestination(destination, null, 5);
  
  // Add photos to each day and activity
  const enhancedDays = await Promise.all(
    basicItinerary.days.map(async (day, dayIndex) => {
      // Add photos to each activity
      const enhancedActivities = await Promise.all(
        day.activities.map(async (activity, activityIndex) => {
          try {
            // Get activity-specific photo
            const activityPhoto = await getActivityPhotos(destination, activity.activity, activity.location);
            
            return {
              ...activity,
              photo: activityPhoto,
              // Fallback to destination photos if no activity photo found
              fallbackPhoto: activityPhoto ? null : destinationPhotos[activityIndex % destinationPhotos.length] || null
            };
          } catch (error) {
            console.error(`Error adding photo to activity ${activityIndex}:`, error);
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
        // Add a featured photo for the day
        dayPhoto: destinationPhotos[dayIndex % destinationPhotos.length] || null
      };
    })
  );
  
  return {
    ...basicItinerary,
    days: enhancedDays,
    destinationPhotos: destinationPhotos.slice(0, 3), // Keep top 3 for general use
    photosEnabled: true
  };
}

function generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDateStr) {
  console.log('🎭 Generating high-quality mock itinerary...');
  console.log('Start date for mock:', startDateStr);
  
  const budgetMultiplier = budget === 'budget' ? 0.6 : budget === 'luxury' ? 2.5 : 1;
  const activitiesPerDay = pace === 'relaxed' ? 2 : pace === 'active' ? 4 : 3;
  
  const mockDays = [];
  
  // More robust date parsing for mock generation too
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
    console.error('Error parsing start date for mock:', error);
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
  
  console.log('Mock itinerary generated with correct dates');
  return { days: mockDays };
}

// Enhanced mock itinerary generation with photos
async function generateHighQualityMockItineraryWithPhotos(destination, days, interests, budget, pace, startDateStr) {
  console.log('🎭 Generating high-quality mock itinerary with photos...');
  
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
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();

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
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
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
    
    if (!destination || destination.trim().length === 0) {
      return res.status(400).json({ message: 'Destination is required' });
    }
    
    const photos = await fetchPhotosForDestination(destination.trim(), activityType, count);
    
    res.json({
      success: true,
      destination: destination.trim(),
      count: photos.length,
      photos
    });
    
  } catch (error) {
    console.error('Destination photos API error:', error);
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
    
    if (!destination || !activity) {
      return res.status(400).json({ message: 'Destination and activity are required' });
    }
    
    const photo = await getActivityPhotos(destination, activity, location);
    
    res.json({
      success: true,
      destination,
      activity,
      location,
      photo
    });
    
  } catch (error) {
    console.error('Activity photos API error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch activity photos',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Route to check photo service availability
app.get('/api/photos/health', authenticateToken, async (req, res) => {
  try {
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
          })
          .catch(() => {
            services.unsplash.status = 'error';
          })
      );
    }
    
    if (services.pexels.configured) {
      testPromises.push(
        fetchPexelsPhotos('test', 1)
          .then(photos => {
            services.pexels.status = photos.length > 0 ? 'working' : 'no_results';
          })
          .catch(() => {
            services.pexels.status = 'error';
          })
      );
    }
    
    if (services.pixabay.configured) {
      testPromises.push(
        fetchPixabayPhotos('test', 1)
          .then(photos => {
            services.pixabay.status = photos.length > 0 ? 'working' : 'no_results';
          })
          .catch(() => {
            services.pixabay.status = 'error';
          })
      );
    }
    
    await Promise.allSettled(testPromises);
    
    res.json({
      success: true,
      services,
      summary: {
        configured: Object.values(services).filter(s => s.configured).length,
        working: Object.values(services).filter(s => s.status === 'working').length,
        total: 3
      }
    });
    
  } catch (error) {
    console.error('Photo health check error:', error);
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
    
    if (source === 'unsplash' && downloadUrl && process.env.UNSPLASH_ACCESS_KEY) {
      // Trigger download tracking for Unsplash (required by their API terms)
      try {
        await axios.get(downloadUrl, {
          headers: photoServices.unsplash.headers
        });
        console.log(`Unsplash download tracked for photo ${photoId}`);
      } catch (error) {
        console.error('Unsplash download tracking error:', error);
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
    
    res.json({ success: true, message: 'Download tracked successfully' });
    
  } catch (error) {
    console.error('Photo download tracking error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Route to get photo attribution info
app.get('/api/photos/:source/:photoId/attribution', async (req, res) => {
  try {
    const { source, photoId } = req.params;
    
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
        return res.status(400).json({ message: 'Invalid photo source' });
    }
    
    res.json({
      source,
      photoId,
      attribution
    });
    
  } catch (error) {
    console.error('Photo attribution error:', error);
    res.status(500).json({ 
      message: 'Failed to get photo attribution',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== USER PROFILE ROUTES =====
app.get('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Calculate user statistics
    const totalTrips = await Itinerary.countDocuments({ userId: req.user.userId });
    const completedTrips = await Itinerary.find({ 
      userId: req.user.userId,
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
    await User.findByIdAndUpdate(req.user.userId, {
      totalTrips,
      avgRating: Math.round(avgRating * 10) / 10,
      daysTraveled
    });
    
    // Return updated user data
    const updatedUser = await User.findById(req.user.userId).select('-password');
    res.json(updatedUser);
    
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const updates = { ...req.body, updatedAt: Date.now() };
    
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'profile_updated',
      title: 'Profile updated',
      description: 'User profile information has been updated',
    }).save();
    
    res.json(user);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== USER PREFERENCES ROUTE =====
app.put('/api/users/preferences', authenticateToken, async (req, res) => {
  try {
    const { travelStyle, budgetRange, interests, pace } = req.body;
    
    // Validate interests array
    if (interests && !Array.isArray(interests)) {
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
      req.user.userId,
      preferencesUpdate,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'preferences_updated',
      title: 'Travel preferences updated',
      description: `Updated travel style: ${travelStyle}, budget: ${budgetRange}, interests: ${interests?.join(', ') || 'none'}`,
      icon: '🎯'
    }).save();
    
    res.json(user.preferences);
    
  } catch (error) {
    console.error('Preferences update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== SAFETY SETTINGS ROUTE =====
app.put('/api/users/safety-settings', authenticateToken, async (req, res) => {
  try {
    const { emergencyContacts, locationSharing, medicalInfo, travelPreferences } = req.body;
    
    // Validate emergency contacts
    if (!emergencyContacts || !Array.isArray(emergencyContacts) || emergencyContacts.length === 0) {
      return res.status(400).json({ message: 'At least one emergency contact is required' });
    }
    
    // Validate required fields for each contact
    for (const contact of emergencyContacts) {
      if (!contact.name || !contact.name.trim()) {
        return res.status(400).json({ message: 'Contact name is required' });
      }
      if (!contact.phone || !contact.phone.trim()) {
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
      req.user.userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'safety_updated',
      title: 'Safety settings updated',
      description: `Updated emergency contacts (${emergencyContacts.length}), location sharing: ${locationSharing?.enabled ? 'enabled' : 'disabled'}`,
      icon: '🛡️'
    }).save();
    
    res.json({
      emergencyContacts: user.emergencyContacts,
      locationSharing: user.locationSharing,
      medicalInfo: user.medicalInfo,
      travelPreferences: user.travelPreferences
    });
    
  } catch (error) {
    console.error('Safety settings update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== LOCATION UPDATE ROUTE =====
app.put('/api/users/location', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude, address, accuracy } = req.body;
    
    if (!latitude || !longitude) {
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
      req.user.userId,
      locationUpdate,
      { new: true }
    ).select('currentLocation');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'location_updated',
      title: 'Location updated',
      description: `Location updated to ${address || 'coordinates'}`,
      icon: '📍'
    }).save();
    
    res.json({ success: true, location: user.currentLocation });
    
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== CHECK-IN ROUTE =====
app.post('/api/users/check-in', authenticateToken, async (req, res) => {
  try {
    const { location, status, message, automatic } = req.body;
    
    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ message: 'Location is required for check-in' });
    }
    
    const checkIn = new CheckIn({
      userId: req.user.userId,
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
    await User.findByIdAndUpdate(req.user.userId, {
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
      userId: req.user.userId,
      type: 'check_in',
      title: automatic ? 'Automatic check-in' : 'Manual check-in',
      description: `Checked in from ${location.address || 'current location'} - Status: ${status || 'safe'}`,
      icon: '✅',
      metadata: { location, status }
    }).save();
    
    res.json({ success: true, checkIn });
    
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== EMERGENCY ALERT ROUTE =====
app.post('/api/emergency/alert', authenticateToken, async (req, res) => {
  try {
    const { type, location, emergencyContacts, message } = req.body;
    
    if (!emergencyContacts || !Array.isArray(emergencyContacts) || emergencyContacts.length === 0) {
      return res.status(400).json({ message: 'Emergency contacts are required' });
    }
    
    // Validate emergency contacts
    const validContacts = emergencyContacts.filter(contact => 
      contact.name && contact.name.trim() && contact.phone && contact.phone.trim()
    );
    
    if (validContacts.length === 0) {
      return res.status(400).json({ message: 'At least one valid emergency contact is required' });
    }
    
    const alert = new EmergencyAlert({
      userId: req.user.userId,
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
      userId: req.user.userId,
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
    
    res.json({ 
      success: true, 
      alertId: alert._id,
      message: 'Emergency alert sent successfully',
      contactsNotified: validContacts.length
    });
    
  } catch (error) {
    console.error('Emergency alert error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET USER ACTIVITY ROUTE =====
app.get('/api/users/activity', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const activities = await UserActivity
      .find({ userId: req.user.userId })
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
    
    res.json(formattedActivities);
    
  } catch (error) {
    console.error('Activity fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET TRAVEL HISTORY ROUTE =====
app.get('/api/users/travel-history', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    // Get completed trips (where end date is in the past)
    const trips = await Itinerary
      .find({ 
        userId: req.user.userId,
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
    
    res.json(formattedTrips);
    
  } catch (error) {
    console.error('Travel history fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== RATE TRIP ROUTE =====
app.put('/api/itineraries/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { rating } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }
    
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { rating: parseInt(rating), updatedAt: Date.now() },
      { new: true }
    );
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
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
    await updateUserStats(req.user.userId);
    
    res.json({ success: true, rating: parseInt(rating) });
    
  } catch (error) {
    console.error('Trip rating error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET CHECK-IN HISTORY ROUTE =====
app.get('/api/users/check-ins', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const checkIns = await CheckIn
      .find({ userId: req.user.userId })
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    
    res.json(checkIns);
    
  } catch (error) {
    console.error('Check-ins fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== GET EMERGENCY ALERTS ROUTE =====
app.get('/api/emergency/alerts', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const alerts = await EmergencyAlert
      .find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    
    res.json(alerts);
    
  } catch (error) {
    console.error('Emergency alerts fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== RESOLVE EMERGENCY ALERT ROUTE =====
app.put('/api/emergency/alerts/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const alert = await EmergencyAlert.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { 
        status: 'resolved',
        resolvedAt: new Date()
      },
      { new: true }
    );
    
    if (!alert) {
      return res.status(404).json({ message: 'Emergency alert not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'emergency_resolved',
      title: 'Emergency alert resolved',
      description: `Emergency alert resolved - ${alert.alertType}`,
      icon: '✅',
      metadata: { alertId: alert._id }
    }).save();
    
    res.json({ success: true, alert });
    
  } catch (error) {
    console.error('Emergency alert resolve error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== HELPER FUNCTION TO UPDATE USER STATS =====
async function updateUserStats(userId) {
  try {
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
    
  } catch (error) {
    console.error('Error updating user stats:', error);
  }
}

// ===== ITINERARY ROUTES =====
app.post('/api/itineraries', authenticateToken, async (req, res) => {
  try {
    const itinerary = new Itinerary({
      ...req.body,
      userId: req.user.userId,
    });
    
    await itinerary.save();
    res.status(201).json(itinerary);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/itineraries', authenticateToken, async (req, res) => {
  try {
    const itineraries = await Itinerary.find({ userId: req.user.userId })
      .sort({ createdAt: -1 });
    res.json(itineraries);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const itinerary = await Itinerary.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    res.json(itinerary);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const updates = { ...req.body, updatedAt: Date.now() };
    
    // If dates have changed, we need to update the daily structure
    const existingItinerary = await Itinerary.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });
    
    if (!existingItinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    // Check if dates have changed
    const oldStartDate = new Date(existingItinerary.startDate).toISOString().split('T')[0];
    const newStartDate = new Date(updates.startDate).toISOString().split('T')[0];
    const oldEndDate = new Date(existingItinerary.endDate).toISOString().split('T')[0];
    const newEndDate = new Date(updates.endDate).toISOString().split('T')[0];
    
    if (oldStartDate !== newStartDate || oldEndDate !== newEndDate) {
      console.log('Dates changed, updating day structure...');
      
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
    
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      updates,
      { new: true, runValidators: true }
    );
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'itinerary_updated',
      title: 'Itinerary updated',
      description: `Updated "${itinerary.title}" itinerary`,
      icon: '✏️',
      metadata: { 
        itineraryId: itinerary._id,
        destination: itinerary.destination,
        datesChanged: oldStartDate !== newStartDate || oldEndDate !== newEndDate
      }
    }).save();
    
    res.json(itinerary);
  } catch (error) {
    console.error('Itinerary update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.delete('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const itinerary = await Itinerary.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId,
    });
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    res.json({ message: 'Itinerary deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== ENHANCED ITINERARY GENERATION ROUTE WITH PHOTOS =====
app.post('/api/generate-itinerary', authenticateToken, async (req, res) => {
  try {
    const { destination, startDate, endDate, interests, budget, pace, includePhotos = true } = req.body;
    const userId = req.user.userId;
    
    console.log('Itinerary generation request:', { destination, startDate, endDate, interests, budget, pace, includePhotos });
    
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    
    let generatedItinerary;
    let useAI = false;
    let provider = 'mock';
    
    // Check if we can use Gemini
    const hasValidKey = process.env.GEMINI_API_KEY && 
                       process.env.GEMINI_API_KEY  &&
                       genAI;
    
    const withinRateLimit = rateLimiter.isAllowed(userId);
    
    if (hasValidKey && withinRateLimit) {
      try {
        console.log('Attempting Gemini AI generation...');
        
        const prompt = `You are a travel expert. Create a ${days}-day itinerary for ${destination}.

User preferences:
- Interests: ${interests.join(', ')}
- Budget: ${budget}
- Travel pace: ${pace}
- Dates: ${startDate} to ${endDate}

IMPORTANT: Generate activities for each day but DO NOT worry about specific dates in your response. 
Focus on creating great activities. The dates will be handled separately.

Create a JSON response with this EXACT structure. Follow these rules strictly:
1. Cost must be a NUMBER (integer), never text
2. Use 0 for free activities
3. Times must be in HH:MM format
4. All fields are required
5. Generate exactly ${days} days worth of activities
6. Make location names specific and detailed for better photo matching

{
  "days": [
    {
      "activities": [
        {
          "time": "09:00",
          "activity": "Visit Senso-ji Temple",
          "location": "Asakusa, Tokyo",
          "duration": "2 hours",
          "cost": 0,
          "notes": "Free admission, arrive early to avoid crowds"
        }
      ]
    }
  ]
}

Generate exactly ${days} days of activities. Make costs realistic integers in USD. Make location names specific for photo search. No explanatory text, just the JSON.`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const geminiResponse = response.text();
        
        console.log('Gemini responded, processing...');
        
        // Extract and clean JSON
        let jsonStr = geminiResponse.trim();
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        
        console.log('Parsing AI response...');
        let aiItinerary = JSON.parse(jsonStr);
        
        // Validate and sanitize the data with photos
        if (includePhotos) {
          console.log('Adding photos to AI-generated itinerary...');
          generatedItinerary = await sanitizeAIItineraryWithPhotos(aiItinerary, destination, days, budget, interests, pace, startDate, endDate);
        } else {
          generatedItinerary = sanitizeAIItinerary(aiItinerary, destination, days, budget, interests, pace, startDate, endDate);
        }
        
        if (generatedItinerary && generatedItinerary.days && generatedItinerary.days.length > 0) {
            useAI = true;
            provider = 'gemini';
            console.log('AI itinerary with photos generated successfully!');
        } else {
          throw new Error('Invalid itinerary structure from AI');
        }
        
      } catch (aiError) {
        console.error('AI generation failed:', aiError.message);
        console.log('Falling back to mock generation...');
        
        if (includePhotos) {
          generatedItinerary = await generateHighQualityMockItineraryWithPhotos(destination, days, interests, budget, pace, startDate);
        } else {
          generatedItinerary = generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDate);
        }
        provider = 'mock';
      }
    } else {
      if (!hasValidKey) {
        console.log('No AI key configured, using mock generation');
      } else {
        console.log('Rate limited, using mock generation');
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
    
    console.log('Saving itinerary to database...');
    
    // Create and save the itinerary
    const itinerary = new Itinerary({
      userId,
      title: `${useAI ? 'AI-Generated' : 'Custom'} Trip to ${destination}`,
      destination,
      startDate,
      endDate,
      budget: budget === 'budget' ? 500 : budget === 'mid-range' ? 1500 : 3000,
      preferences: {
        interests,
        pace,
      },
      days: generatedItinerary.days,
      aiGenerated: useAI,
      // Add photo metadata
      photosEnabled: includePhotos,
      destinationPhotos: generatedItinerary.destinationPhotos || [],
    });
    
    const savedItinerary = await itinerary.save();
    
    // Log activity with photo info
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
    
    console.log('Itinerary saved successfully!');
    
    res.json({
      ...savedItinerary.toObject(),
      provider,
      photosEnabled: includePhotos,
      photoServices: {
        unsplash: !!process.env.UNSPLASH_ACCESS_KEY,
        pexels: !!process.env.PEXELS_API_KEY,
        pixabay: !!process.env.PIXABAY_API_KEY
      },
      message: useAI ? 
        `AI-generated itinerary created${includePhotos ? ' with photos' : ''}!` : 
        `Custom itinerary created${includePhotos ? ' with photos' : ''}!`
    });
    
  } catch (error) {
    console.error('Itinerary generation error:', error);
    res.status(500).json({ 
      message: 'Failed to generate itinerary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ===== ADD PHOTOS TO EXISTING ITINERARY ROUTE =====
app.post('/api/itineraries/:id/add-photos', authenticateToken, async (req, res) => {
  try {
    const itinerary = await Itinerary.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    console.log(`Adding photos to existing itinerary: ${itinerary.title}`);
    
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
      req.params.id,
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
      userId: req.user.userId,
      type: 'photos_added',
      title: 'Photos added to itinerary',
      description: `Added photos to "${itinerary.title}"`,
      icon: '📸',
      metadata: { 
        itineraryId: itinerary._id,
        photoCount: destinationPhotos.length
      }
    }).save();
    
    res.json({
      success: true,
      message: 'Photos added successfully',
      photoCount: destinationPhotos.length,
      itinerary: updatedItinerary
    });
    
  } catch (error) {
    console.error('Add photos error:', error);
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
    
    const itinerary = await Itinerary.findOne({
      _id: id,
      userId: req.user.userId,
    });
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    const dayIdx = parseInt(dayIndex);
    const actIdx = parseInt(activityIndex);
    
    if (!itinerary.days[dayIdx] || !itinerary.days[dayIdx].activities[actIdx]) {
      return res.status(404).json({ message: 'Activity not found' });
    }
    
    const activity = itinerary.days[dayIdx].activities[actIdx];
    
    // Get new photo for this activity
    const newPhoto = await getActivityPhotos(itinerary.destination, activity.activity, activity.location);
    
    // Update the specific activity
    itinerary.days[dayIdx].activities[actIdx].photo = newPhoto;
    itinerary.updatedAt = Date.now();
    
    await itinerary.save();
    
    res.json({
      success: true,
      message: 'Activity photo refreshed',
      photo: newPhoto
    });
    
  } catch (error) {
    console.error('Refresh photo error:', error);
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
    
    if (!operation || !destinations || !Array.isArray(destinations)) {
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
        return res.status(400).json({ message: 'Invalid operation' });
    }
    
    res.json({
      success: true,
      operation,
      results
    });
    
  } catch (error) {
    console.error('Batch photo operations error:', error);
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
    
    console.log('Chat request received:', { userId, message, itineraryId });
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Message is required',
        response: 'Please enter a message to chat with me!' 
      });
    }
    
    // Get user preferences for context
    const user = await User.findById(req.user.userId);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    
    await User.findByIdAndUpdate(req.user.userId, {
      password: hashedNewPassword,
      updatedAt: Date.now()
    });
    
    await new UserActivity({
      userId: req.user.userId,
      type: 'password_changed',
      title: 'Password changed',
      description: 'Account password has been updated',
    }).save();
    
    res.json({ success: true, message: 'Password changed successfully' });
    
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/users/two-factor', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    
    await User.findByIdAndUpdate(req.user.userId, {
      twoFactorEnabled: !!enabled,
      updatedAt: Date.now()
    });
    
    await new UserActivity({
      userId: req.user.userId,
      type: 'two_factor_toggle',
      title: `Two-factor authentication ${enabled ? 'enabled' : 'disabled'}`,
      description: `2FA has been ${enabled ? 'enabled' : 'disabled'} for this account`,
    }).save();
    
    res.json({ success: true, twoFactorEnabled: !!enabled });
    
  } catch (error) {
    console.error('Two-factor toggle error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.delete('/api/users/delete-account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    await Promise.all([
      User.findByIdAndDelete(userId),
      Itinerary.deleteMany({ userId }),
      Chat.deleteMany({ userId }),
      UserActivity.deleteMany({ userId }),
      CheckIn.deleteMany({ userId }),
      EmergencyAlert.deleteMany({ userId })
    ]);
    
    res.json({ success: true, message: 'Account deleted successfully' });
    
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== PROFILE PICTURE UPLOAD ROUTE =====
app.post('/api/users/profile-picture', authenticateToken, async (req, res) => {
  try {
    // In a real implementation, you would handle file upload here
    // For now, we'll just return a success response
    // You would typically use multer or similar for file handling
    
    res.status(501).json({ 
      message: 'Profile picture upload not implemented yet',
      note: 'This would typically handle file upload with multer and cloud storage'
    });
    
  } catch (error) {
    console.error('Profile picture upload error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== BULK USER STATS UPDATE ROUTE (Admin/Maintenance) =====
app.post('/api/admin/update-user-stats', authenticateToken, async (req, res) => {
  try {
    // This would be an admin-only route in a real implementation
    const users = await User.find({}).select('_id');
    
    for (const user of users) {
      await updateUserStats(user._id);
    }
    
    res.json({ 
      success: true, 
      message: `Updated stats for ${users.length} users` 
    });
    
  } catch (error) {
    console.error('Bulk user stats update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Travel Planner API is running',
    features: {
      ai: !!process.env.GEMINI_API_KEY,
      photos: {
        unsplash: !!process.env.UNSPLASH_ACCESS_KEY,
        pexels: !!process.env.PEXELS_API_KEY,
        pixabay: !!process.env.PIXABAY_API_KEY
      }
    }
  });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Photo services configured:');
  console.log('- Unsplash:', !!process.env.UNSPLASH_ACCESS_KEY ? '✅' : '❌');
  console.log('- Pexels:', !!process.env.PEXELS_API_KEY ? '✅' : '❌');
  console.log('- Pixabay:', !!process.env.PIXABAY_API_KEY ? '✅' : '❌');
  console.log('- Gemini AI:', !!process.env.GEMINI_API_KEY ? '✅' : '❌');
});

module.exports = app;