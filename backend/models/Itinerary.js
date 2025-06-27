const mongoose = require('mongoose');

const itinerarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  destination: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  budget: Number,
  preferences: {
    interests: [String],
    pace: String,
    accommodation: String,
  },
  days: [{
    date: Date,
    activities: [{
      time: String,
      activity: String,
      location: String,
      duration: String,
      cost: Number,
      notes: String,
    }],
  }],
  rating: { type: Number, min: 1, max: 5 },
  aiGenerated: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Itinerary', itinerarySchema);
