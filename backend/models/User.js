const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: String,
  location: String,
  bio: String,
  profilePicture: String,
  preferences: {
    interests: [String],
    budget: String,
    travelStyle: String,
    budgetRange: String,
    pace: String,
  },
  emergencyContacts: [{
    name: String,
    relationship: String,
    phone: String,
    email: String,
    isPrimary: { type: Boolean, default: false },
  }],
  locationSharing: {
    enabled: { type: Boolean, default: false },
    shareWithContacts: { type: Boolean, default: false },
    shareWithTrustedCircle: { type: Boolean, default: false },
    allowEmergencyAccess: { type: Boolean, default: false },
  },
  medicalInfo: {
    allergies: String,
    medications: String,
    medicalConditions: String,
    bloodType: String,
    emergencyMedicalInfo: String,
  },
  travelPreferences: {
    checkInFrequency: { type: String, default: 'daily' },
    autoCheckIn: { type: Boolean, default: false },
    sosButtonEnabled: { type: Boolean, default: true },
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
    timestamp: Date,
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
