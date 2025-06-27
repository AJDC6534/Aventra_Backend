const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itineraryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Itinerary' },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: String,
    timestamp: { type: Date, default: Date.now },
  }]
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);
