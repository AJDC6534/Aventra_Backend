// ==========================================
// TRAVEL PLANNER API SERVER WITH PHOTO INTEGRATION
// ==========================================

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
// ADD THIS: For photo fetching
const fetch = require('node-fetch'); // npm install node-fetch
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// MIDDLEWARE CONFIGURATION
// ==========================================
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT,DELETE');
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

// ==========================================
// DATABASE CONNECTION
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ==========================================
// AI CONFIGURATION
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// ==========================================
// ADD PHOTO SERVICE CLASS
// ==========================================
class PhotoService {
  constructor() {
    this.unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY;
    this.pixabayKey = process.env.PIXABAY_API_KEY;
    this.pexelsKey = process.env.PEXELS_API_KEY;
  }

  async getUnsplashPhotos(query, count = 1) {
    if (!this.unsplashAccessKey) return [];
    
    try {
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
        {
          headers: {
            'Authorization': `Client-ID ${this.unsplashAccessKey}`
          }
        }
      );
      
      if (!response.ok) throw new Error('Unsplash API error');
      
      const data = await response.json();
      return data.results.map(photo => ({
        url: photo.urls.regular,
        thumbnail: photo.urls.small,
        alt: photo.alt_description || query,
        photographer: photo.user.name,
        photographerUrl: photo.user.links.html,
        source: 'unsplash'
      }));
    } catch (error) {
      console.error('Unsplash API error:', error);
      return [];
    }
  }

  async getPixabayPhotos(query, count = 1) {
    if (!this.pixabayKey) return [];
    
    try {
      const response = await fetch(
        `https://pixabay.com/api/?key=${this.pixabayKey}&q=${encodeURIComponent(query)}&image_type=photo&category=travel&per_page=${count}&min_width=640`
      );
      
      if (!response.ok) throw new Error('Pixabay API error');
      
      const data = await response.json();
      return data.hits.map(photo => ({
        url: photo.webformatURL,
        thumbnail: photo.previewURL,
        alt: photo.tags,
        photographer: photo.user,
        source: 'pixabay'
      }));
    } catch (error) {
      console.error('Pixabay API error:', error);
      return [];
    }
  }

  async getPexelsPhotos(query, count = 1) {
    if (!this.pexelsKey) return [];
    
    try {
      const response = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}`,
        {
          headers: {
            'Authorization': this.pexelsKey
          }
        }
      );
      
      if (!response.ok) throw new Error('Pexels API error');
      
      const data = await response.json();
      return data.photos.map(photo => ({
        url: photo.src.large,
        thumbnail: photo.src.medium,
        alt: photo.alt,
        photographer: photo.photographer,
        source: 'pexels'
      }));
    } catch (error) {
      console.error('Pexels API error:', error);
      return [];
    }
  }

  async getPhotosWithFallback(query, count = 1) {
    // Try Unsplash first (best quality)
    let photos = await this.getUnsplashPhotos(query, count);
    
    // Fallback to Pixabay if not enough photos
    if (photos.length < count) {
      const remaining = count - photos.length;
      const pixabayPhotos = await this.getPixabayPhotos(query, remaining);
      photos = [...photos, ...pixabayPhotos];
    }
    
    // Final fallback to Pexels
    if (photos.length < count) {
      const remaining = count - photos.length;
      const pexelsPhotos = await this.getPexelsPhotos(query, remaining);
      photos = [...photos, ...pexelsPhotos];
    }
    
    return photos;
  }

  async addPhotosToItinerary(itinerary) {
    console.log('📸 Adding photos to itinerary...');
    
    try {
      // Add destination hero image
      const heroPhotos = await this.getPhotosWithFallback(`${itinerary.destination} skyline landmark`, 1);
      itinerary.heroImage = heroPhotos[0] || null;

      // Process each day
      const enhancedDays = await Promise.all(
        itinerary.days.map(async (day, dayIndex) => {
          console.log(`📸 Processing photos for day ${dayIndex + 1}...`);
          
          // Day theme image based on activities
          const dayTheme = this.extractDayTheme(day.activities, itinerary.destination);
          const themePhotos = await this.getPhotosWithFallback(dayTheme, 1);
          day.themeImage = themePhotos[0] || null;

          // Add photos to activities
          if (day.activities && day.activities.length > 0) {
            const enhancedActivities = await Promise.all(
              day.activities.map(async (activity) => {
                const activityPhotos = await this.getActivityPhotos(activity, itinerary.destination);
                return {
                  ...activity,
                  photos: activityPhotos,
                  mainPhoto: activityPhotos[0] || null
                };
              })
            );
            day.activities = enhancedActivities;
          }

          return day;
        })
      );

      return {
        ...itinerary,
        days: enhancedDays,
        hasPhotos: true,
        photoStats: {
          totalPhotos: this.countTotalPhotos({ ...itinerary, days: enhancedDays }),
          lastUpdated: new Date()
        }
      };
    } catch (error) {
      console.error('Photo processing failed:', error);
      return {
        ...itinerary,
        hasPhotos: false,
        photoError: 'Photos could not be loaded'
      };
    }
  }

  extractDayTheme(activities, destination) {
    if (!activities || activities.length === 0) {
      return `${destination} city`;
    }
    
    const firstActivity = activities[0];
    const activityLower = firstActivity.activity.toLowerCase();
    
    if (activityLower.includes('museum') || activityLower.includes('temple') || activityLower.includes('palace')) {
      return `${destination} culture history`;
    } else if (activityLower.includes('park') || activityLower.includes('garden') || activityLower.includes('nature')) {
      return `${destination} nature park`;
    } else if (activityLower.includes('market') || activityLower.includes('food') || activityLower.includes('restaurant')) {
      return `${destination} food market`;
    } else if (activityLower.includes('shopping') || activityLower.includes('street') || activityLower.includes('district')) {
      return `${destination} shopping street`;
    } else {
      return `${destination} attractions`;
    }
  }

  async getActivityPhotos(activity, destination) {
    const searchTerms = [
      `${activity.activity} ${destination}`,
      `${activity.location || ''} ${destination}`.trim(),
      `${this.extractActivityType(activity.activity)} ${destination}`,
      activity.activity
    ].filter(term => term.trim() && !term.includes('undefined'));

    for (const term of searchTerms) {
      const photos = await this.getPhotosWithFallback(term, 2);
      if (photos.length > 0) return photos;
    }

    return [];
  }

  extractActivityType(activityName) {
    const activityLower = activityName.toLowerCase();
    
    if (activityLower.includes('visit') || activityLower.includes('see') || activityLower.includes('explore')) {
      return 'sightseeing attraction';
    } else if (activityLower.includes('museum')) {
      return 'museum';
    } else if (activityLower.includes('temple') || activityLower.includes('church') || activityLower.includes('shrine')) {
      return 'religious site';
    } else if (activityLower.includes('park') || activityLower.includes('garden')) {
      return 'park garden';
    } else if (activityLower.includes('market') || activityLower.includes('shopping')) {
      return 'market shopping';
    } else if (activityLower.includes('food') || activityLower.includes('restaurant') || activityLower.includes('cafe')) {
      return 'restaurant food';
    } else {
      return 'tourist attraction';
    }
  }

  countTotalPhotos(itinerary) {
    let count = 0;
    if (itinerary.heroImage) count++;
    
    itinerary.days.forEach(day => {
      if (day.themeImage) count++;
      if (day.activities) {
        day.activities.forEach(activity => {
          count += activity.photos?.length || 0;
        });
      }
    });
    
    return count;
  }
}

// ==========================================
// RATE LIMITER SYSTEM
// ==========================================
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

// ==========================================
// UPDATE ITINERARY SCHEMA TO INCLUDE PHOTOS
// ==========================================
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
  
  // NEW PHOTO FIELDS
  heroImage: {
    url: String,
    thumbnail: String,
    alt: String,
    photographer: String,
    source: String
  },
  
  hasPhotos: {
    type: Boolean,
    default: false
  },
  
  photoStats: {
    totalPhotos: { type: Number, default: 0 },
    lastUpdated: Date
  },
  
  days: [{
    date: String,
    
    // NEW: Day theme image
    themeImage: {
      url: String,
      thumbnail: String,
      alt: String,
      photographer: String,
      source: String
    },
    
    activities: [{
      time: String,
      activity: String,
      location: String,
      duration: String,
      cost: Number,
      notes: String,
      
      // NEW: Activity photos
      photos: [{
        url: String,
        thumbnail: String,
        alt: String,
        photographer: String,
        source: String
      }],
      mainPhoto: {
        url: String,
        thumbnail: String,
        alt: String,
        photographer: String,
        source: String
      }
    }],
  }],
  
  rating: { type: Number, min: 1, max: 5 },
  aiGenerated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Continue with your existing schemas...
const userSchema = new mongoose.Schema({
  // Keep all your existing user schema fields
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  location: { type: String },
  bio: { type: String },
  profilePicture: { type: String },
  
  preferences: {
    interests: [String],
    budget: String,
    travelStyle: String,
    budgetRange: String,
    pace: String,
  },
  
  emergencyContacts: [{
    name: { type: String, required: true },
    relationship: { type: String },
    phone: { type: String, required: true },
    email: { type: String },
    isPrimary: { type: Boolean, default: false }
  }],
  
  locationSharing: {
    enabled: { type: Boolean, default: false },
    shareWithContacts: { type: Boolean, default: false },
    shareWithTrustedCircle: { type: Boolean, default: false },
    allowEmergencyAccess: { type: Boolean, default: false }
  },
  
  medicalInfo: {
    allergies: String,
    medications: String,
    medicalConditions: String,
    bloodType: String,
    emergencyMedicalInfo: String
  },
  
  travelPreferences: {
    checkInFrequency: { type: String, default: 'daily' },
    autoCheckIn: { type: Boolean, default: false },
    sosButtonEnabled: { type: Boolean, default: true }
  },
  
  totalTrips: { type: Number, default: 0 },
  countriesVisited: { type: Number, default: 0 },
  daysTraveled: { type: Number, default: 0 },
  avgRating: { type: Number, default: 0 },
  
  twoFactorEnabled: { type: Boolean, default: false },
  
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

// Keep all your other existing schemas...
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

// ==========================================
// DATABASE MODELS
// ==========================================
const User = mongoose.model('User', userSchema);
const Itinerary = mongoose.model('Itinerary', itinerarySchema);
const Chat = mongoose.model('Chat', chatSchema);
const UserActivity = mongoose.model('UserActivity', userActivitySchema);
const CheckIn = mongoose.model('CheckIn', checkInSchema);
const EmergencyAlert = mongoose.model('EmergencyAlert', emergencyAlertSchema);

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
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

// ==========================================
// KEEP ALL YOUR EXISTING UTILITY FUNCTIONS
// ==========================================

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

// AI Itinerary Sanitization
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
    console.error('Error parsing start date:', error);
    startDate = new Date();
  }
  
  console.log('Parsed start date:', startDate.toISOString());
  
  for (let i = 0; i < expectedDays; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    const correctDateStr = currentDate.toISOString().split('T')[0];
    
    console.log(`Day ${i + 1} correct date: ${correctDateStr}`);
    
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
  
  console.log('Sanitization complete with correct dates');
  return { days: sanitizedDays };
}

// Mock Itinerary Generation
function generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDateStr) {
  console.log('🎭 Generating high-quality mock itinerary...');
  console.log('Start date for mock:', startDateStr);
  
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

// User Statistics Helper
async function updateUserStats(userId) {
  try {
    const totalTrips = await Itinerary.countDocuments({ userId });
    const completedTrips = await Itinerary.find({ 
      userId,
      endDate: { $lt: new Date() }
    });
    
    const ratedTrips = completedTrips.filter(trip => trip.rating);
    const avgRating = ratedTrips.length > 0 
      ? ratedTrips.reduce((sum, trip) => sum + trip.rating, 0) / ratedTrips.length 
      : 0;
    
    const daysTraveled = completedTrips.reduce((total, trip) => {
      const days = Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)) + 1;
      return total + days;
    }, 0);
    
    const uniqueDestinations = [...new Set(completedTrips.map(trip => trip.destination))];
    const countriesVisited = uniqueDestinations.length;
    
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

// ==========================================
// KEEP ALL YOUR EXISTING AUTHENTICATION ROUTES
// ==========================================

// User Registration
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

// User Login
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

// ==========================================
// KEEP ALL YOUR EXISTING USER PROFILE ROUTES
// (I'll skip these for brevity - they remain exactly the same)
// ==========================================

// Get User Profile
app.get('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const totalTrips = await Itinerary.countDocuments({ userId: req.user.userId });
    const completedTrips = await Itinerary.find({ 
      userId: req.user.userId,
      endDate: { $lt: new Date() }
    });
    
    const ratedTrips = completedTrips.filter(trip => trip.rating);
    const avgRating = ratedTrips.length > 0 
      ? ratedTrips.reduce((sum, trip) => sum + trip.rating, 0) / ratedTrips.length 
      : 0;
    
    const daysTraveled = completedTrips.reduce((total, trip) => {
      const days = Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)) + 1;
      return total + days;
    }, 0);
    
    await User.findByIdAndUpdate(req.user.userId, {
      totalTrips,
      avgRating: Math.round(avgRating * 10) / 10,
      daysTraveled
    });
    
    const updatedUser = await User.findById(req.user.userId).select('-password');
    res.json(updatedUser);
    
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ==========================================
// UPDATED AI ITINERARY GENERATION ROUTE WITH PHOTOS
// ==========================================
app.post('/api/generate-itinerary', authenticateToken, async (req, res) => {
  try {
    const { destination, startDate, endDate, interests, budget, pace } = req.body;
    const userId = req.user.userId;
    
    console.log('🚀 Itinerary generation request with photos:', { destination, startDate, endDate, interests, budget, pace });
    
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    
    let generatedItinerary;
    let useAI = false;
    let provider = 'mock';
    
    // Check if we can use Gemini
    const hasValidKey = process.env.GEMINI_API_KEY && 
                       process.env.GEMINI_API_KEY.length > 10 &&
                       genAI;
    
    const withinRateLimit = rateLimiter.isAllowed(userId);
    
    if (hasValidKey && withinRateLimit) {
      try {
        console.log('🤖 Attempting Gemini AI generation...');
        
        const prompt = `You are a travel expert. Create a ${days}-day itinerary for ${destination}.

User preferences:
- Interests: ${interests.join(', ')}
- Budget: ${budget}
- Travel pace: ${pace}
- Dates: ${startDate} to ${endDate}

IMPORTANT: Generate activities for each day but DO NOT worry about specific dates in your response. 
Focus on creating great activities with SPECIFIC names that can be used to search for photos.

For each activity, include:
- Specific landmark names (e.g., "Eiffel Tower" not "famous tower")
- Exact location names (e.g., "Shibuya District" not "downtown area")
- Recognizable attractions (e.g., "Louvre Museum" not "art museum")

Create a JSON response with this EXACT structure:

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

Generate exactly ${days} days of activities. Make costs realistic integers in USD. Use specific, photo-searchable activity names.`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const geminiResponse = response.text();
        
        console.log('✅ Gemini responded, processing...');
        
        // Extract and clean JSON
        let jsonStr = geminiResponse.trim();
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        
        console.log('📊 Parsing AI response...');
        let aiItinerary = JSON.parse(jsonStr);
        
        // Validate and sanitize the data
        const sanitizedItinerary = sanitizeAIItinerary(aiItinerary, destination, days, budget, interests, pace, startDate, endDate);
        
        if (sanitizedItinerary && sanitizedItinerary.days && sanitizedItinerary.days.length > 0) {
            generatedItinerary = sanitizedItinerary;
            useAI = true;
            provider = 'gemini';
            console.log('🎉 AI itinerary generated successfully!');
        } else {
          throw new Error('Invalid itinerary structure from AI');
        }
        
      } catch (aiError) {
        console.error('❌ AI generation failed:', aiError.message);
        console.log('🔄 Falling back to mock generation...');
        generatedItinerary = generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDate);
        provider = 'mock';
      }
    } else {
      if (!hasValidKey) {
        console.log('🔑 No AI key configured, using mock generation');
      } else {
        console.log('⏰ Rate limited, using mock generation');
      }
      generatedItinerary = generateHighQualityMockItinerary(destination, days, interests, budget, pace, startDate);
      provider = 'mock';
    }
    
    // Final validation
    if (!generatedItinerary || !generatedItinerary.days || generatedItinerary.days.length === 0) {
      throw new Error('Failed to generate valid itinerary');
    }
    
    // NEW: Add photos to the itinerary
    console.log('📸 Adding photos to itinerary...');
    const photoService = new PhotoService();
    
    // Prepare itinerary object for photo processing
    const itineraryForPhotos = {
      destination,
      days: generatedItinerary.days
    };
    
    const itineraryWithPhotos = await photoService.addPhotosToItinerary(itineraryForPhotos);
    
    console.log('💾 Saving itinerary with photos to database...');
    
    // Create and save the itinerary with photos
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
      days: itineraryWithPhotos.days,
      heroImage: itineraryWithPhotos.heroImage,
      hasPhotos: itineraryWithPhotos.hasPhotos,
      photoStats: itineraryWithPhotos.photoStats,
      aiGenerated: useAI,
    });
    
    const savedItinerary = await itinerary.save();
    
    // Log activity
    await new UserActivity({
      userId,
      type: 'itinerary_generated',
      title: `${useAI ? 'AI-Generated' : 'Custom'} itinerary created with photos`,
      description: `Generated ${days}-day trip to ${destination} with ${itineraryWithPhotos.photoStats?.totalPhotos || 0} photos`,
      icon: useAI ? '🤖' : '✈️',
      metadata: { 
        itineraryId: savedItinerary._id,
        destination,
        provider,
        aiGenerated: useAI,
        days,
        hasPhotos: itineraryWithPhotos.hasPhotos,
        totalPhotos: itineraryWithPhotos.photoStats?.totalPhotos || 0
      }
    }).save();
    
    console.log(`🎯 Itinerary saved successfully with ${itineraryWithPhotos.photoStats?.totalPhotos || 0} photos!`);
    
    res.json({
      ...savedItinerary.toObject(),
      provider,
      photoStats: itineraryWithPhotos.photoStats,
      message: useAI 
        ? `AI-generated itinerary created with ${itineraryWithPhotos.photoStats?.totalPhotos || 0} photos!` 
        : `Custom itinerary created with ${itineraryWithPhotos.photoStats?.totalPhotos || 0} photos!`
    });
    
  } catch (error) {
    console.error('❌ Itinerary generation error:', error);
    res.status(500).json({ 
      message: 'Failed to generate itinerary with photos',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ==========================================
// KEEP ALL YOUR EXISTING ITINERARY ROUTES
// ==========================================

// Create Itinerary (Manual)
app.post('/api/itineraries', authenticateToken, async (req, res) => {
  try {
    const itineraryData = { ...req.body, userId: req.user.userId };
    
    // NEW: Add photos to manual itineraries too
    console.log('📸 Adding photos to manual itinerary...');
    const photoService = new PhotoService();
    
    const itineraryWithPhotos = await photoService.addPhotosToItinerary(itineraryData);
    
    const itinerary = new Itinerary({
      ...itineraryWithPhotos,
      userId: req.user.userId,
    });
    
    await itinerary.save();
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'itinerary_created',
      title: 'Manual itinerary created with photos',
      description: `Created new itinerary "${itinerary.title}" with ${itineraryWithPhotos.photoStats?.totalPhotos || 0} photos`,
      icon: '✈️',
      metadata: { 
        itineraryId: itinerary._id,
        destination: itinerary.destination,
        hasPhotos: itineraryWithPhotos.hasPhotos,
        totalPhotos: itineraryWithPhotos.photoStats?.totalPhotos || 0
      }
    }).save();
    
    res.status(201).json(itinerary);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get All Itineraries
app.get('/api/itineraries', authenticateToken, async (req, res) => {
  try {
    const itineraries = await Itinerary.find({ userId: req.user.userId })
      .sort({ createdAt: -1 });
    res.json(itineraries);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get Single Itinerary
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

// Update Itinerary
app.put('/api/itineraries/:id', authenticateToken, async (req, res) => {
  try {
    const updates = { ...req.body, updatedAt: Date.now() };
    
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
      
      const newDuration = Math.ceil((new Date(newEndDate) - new Date(newStartDate)) / (1000 * 60 * 60 * 24)) + 1;
      const oldDuration = existingItinerary.days ? existingItinerary.days.length : 0;
      
      const updatedDays = [];
      const startDate = new Date(newStartDate + 'T00:00:00');
      
      for (let i = 0; i < newDuration; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const dateStr = currentDate.toISOString().split('T')[0];
        
        let dayActivities = [];
        if (i < oldDuration && existingItinerary.days[i] && existingItinerary.days[i].activities) {
          dayActivities = existingItinerary.days[i].activities;
        }
        
        updatedDays.push({
          date: dateStr,
          activities: dayActivities
        });
      }
      
      updates.days = updatedDays;
      
      // NEW: Update photos if structure changed significantly
      if (Math.abs(newDuration - oldDuration) > 1) {
        console.log('📸 Updating photos due to major itinerary changes...');
        const photoService = new PhotoService();
        const updatedItineraryWithPhotos = await photoService.addPhotosToItinerary({
          destination: updates.destination || existingItinerary.destination,
          days: updates.days
        });
        
        updates.days = updatedItineraryWithPhotos.days;
        updates.heroImage = updatedItineraryWithPhotos.heroImage;
        updates.hasPhotos = updatedItineraryWithPhotos.hasPhotos;
        updates.photoStats = updatedItineraryWithPhotos.photoStats;
      }
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
        datesChanged: oldStartDate !== newStartDate || oldEndDate !== newEndDate,
        hasPhotos: itinerary.hasPhotos
      }
    }).save();
    
    res.json(itinerary);
  } catch (error) {
    console.error('Itinerary update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ==========================================
// ADD NEW PHOTO-SPECIFIC ROUTES
// ==========================================

// Regenerate Photos for Existing Itinerary
app.post('/api/itineraries/:id/regenerate-photos', authenticateToken, async (req, res) => {
  try {
    const itinerary = await Itinerary.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });
    
    if (!itinerary) {
      return res.status(404).json({ message: 'Itinerary not found' });
    }
    
    console.log('📸 Regenerating photos for existing itinerary...');
    const photoService = new PhotoService();
    
    const itineraryWithNewPhotos = await photoService.addPhotosToItinerary({
      destination: itinerary.destination,
      days: itinerary.days
    });
    
    // Update the itinerary with new photos
    const updatedItinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      {
        days: itineraryWithNewPhotos.days,
        heroImage: itineraryWithNewPhotos.heroImage,
        hasPhotos: itineraryWithNewPhotos.hasPhotos,
        photoStats: itineraryWithNewPhotos.photoStats,
        updatedAt: Date.now()
      },
      { new: true }
    );
    
    // Log activity
    await new UserActivity({
      userId: req.user.userId,
      type: 'photos_regenerated',
      title: 'Photos regenerated',
      description: `Regenerated ${itineraryWithNewPhotos.photoStats?.totalPhotos || 0} photos for "${itinerary.title}"`,
      icon: '📸',
      metadata: { 
        itineraryId: updatedItinerary._id,
        totalPhotos: itineraryWithNewPhotos.photoStats?.totalPhotos || 0
      }
    }).save();
    
    res.json({
      success: true,
      itinerary: updatedItinerary,
      message: `Successfully regenerated ${itineraryWithNewPhotos.photoStats?.totalPhotos || 0} photos!`
    });
    
  } catch (error) {
    console.error('Photo regeneration error:', error);
    res.status(500).json({ message: 'Failed to regenerate photos', error: error.message });
  }
});

// ==========================================
// KEEP ALL YOUR EXISTING ROUTES
// (Safety, Emergency, Chat, etc. - they remain exactly the same)
// ==========================================

// CHAT ROUTE (unchanged)
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, itineraryId } = req.body;
    const userId = req.user.userId;
    
    console.log('💬 Chat request received:', { userId, message, itineraryId });
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Message is required',
        response: 'Please enter a message to chat with me!' 
      });
    }
    
    const user = await User.findById(userId);
    let itinerary = null;
    
    if (itineraryId && itineraryId !== 'undefined' && itineraryId !== '' && itineraryId.length === 24) {
      try {
        itinerary = await Itinerary.findById(itineraryId);
      } catch (err) {
        console.log('Invalid itinerary ID, proceeding without itinerary context');
      }
    }
    
    let aiResponse;
    let useAI = false;
    
    const hasValidKey = process.env.GEMINI_API_KEY && 
                       process.env.GEMINI_API_KEY.length > 10;
    
    const withinRateLimit = rateLimiter.isAllowed(userId);
    
    if (hasValidKey && withinRateLimit && genAI) {
      try {
        console.log('🤖 Attempting Gemini API call...');
        
        let contextPrompt = `You are an expert travel planning assistant. Help users plan amazing trips with personalized recommendations.

INSTRUCTIONS:
- Provide specific, actionable travel advice
- Include practical tips and local insights
- Be enthusiastic but concise
- Use emojis to make responses engaging
- Focus on the user's specific question

`;
        
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
        console.log('✅ Gemini response received successfully');
        
      } catch (geminiError) {
        console.error('❌ Gemini API error:', {
          message: geminiError.message,
          status: geminiError.status
        });
        
        aiResponse = generateIntelligentMockResponse(message, user, itinerary);
        console.log('🔄 Using mock response due to Gemini error');
      }
    } else {
      if (!hasValidKey) {
        console.log('🔑 No valid Gemini key, using mock response');
      } else if (!withinRateLimit) {
        console.log('⏰ Rate limited, using mock response');
      }
      aiResponse = generateIntelligentMockResponse(message, user, itinerary);
    }
    
    const chatItineraryId = (itineraryId && itineraryId !== '' && itineraryId !== 'undefined' && itineraryId.length === 24) 
      ? itineraryId 
      : null;
    
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
    
    if (chat.messages.length > 50) {
      chat.messages = chat.messages.slice(-48);
    }
    
    chat.messages.push(
      { role: 'user', content: message.trim() },
      { role: 'assistant', content: aiResponse }
    );
    
    await chat.save();
    
    res.json({ 
      response: aiResponse,
      aiPowered: useAI,
      provider: useAI ? 'gemini' : 'mock'
    });
    
  } catch (error) {
    console.error('❌ Chat service error:', error);
    res.status(500).json({ 
      message: 'Chat service error', 
      response: 'I apologize, but I am having trouble right now. Please try again in a moment.',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ==========================================
// ALL YOUR OTHER EXISTING ROUTES STAY THE SAME
// ==========================================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Travel Planner API with Photos is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.1.0',
    features: ['AI Itineraries', 'Auto Photos', 'Safety Features']
  });
});

// API Status
app.get('/api/status', (req, res) => {
  const status = {
    server: 'running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    ai: {
      gemini: process.env.GEMINI_API_KEY ? 'configured' : 'not configured',
      rateLimiter: 'active'
    },
    photos: {
      unsplash: process.env.UNSPLASH_ACCESS_KEY ? 'configured' : 'not configured',
      pixabay: process.env.PIXABAY_API_KEY ? 'configured' : 'not configured',
      pexels: process.env.PEXELS_API_KEY ? 'configured' : 'not configured'
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
  
  res.json(status);
});

// ==========================================
// ERROR HANDLING & SERVER START
// ==========================================

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global Error Handler
app.use((error, req, res, next) => {
  console.error('❌ Global error handler:', error);
  
  res.status(error.status || 500).json({
    message: error.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  mongoose.connection.close(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  mongoose.connection.close(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Travel Planner API Server with Photos running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📊 Status: http://localhost:${PORT}/api/status`);
  console.log(`📖 API Info: http://localhost:${PORT}/api/info`);
  
  // AI Status
  if (process.env.GEMINI_API_KEY) {
    console.log('🤖 AI Features: Enabled (Gemini)');
  } else {
    console.log('🤖 AI Features: Mock mode (no API key)');
  }
  
  // Photo API Status
  const photoAPIs = [];
  if (process.env.UNSPLASH_ACCESS_KEY) photoAPIs.push('Unsplash');
  if (process.env.PIXABAY_API_KEY) photoAPIs.push('Pixabay');
  if (process.env.PEXELS_API_KEY) photoAPIs.push('Pexels');
  
  if (photoAPIs.length > 0) {
    console.log(`📸 Photo APIs: Enabled (${photoAPIs.join(', ')})`);
  } else {
    console.log('📸 Photo APIs: Not configured (photos will be skipped)');
  }
  
  console.log('✨ Ready to generate trips with beautiful photos!');
});

// ==========================================
// EXPORT FOR TESTING
// ==========================================
module.exports = app;