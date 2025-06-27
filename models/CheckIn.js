const mongoose = require('mongoose');

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
  automatic: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('CheckIn', checkInSchema);
