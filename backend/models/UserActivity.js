const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  icon: String,
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

module.exports = mongoose.model('UserActivity', userActivitySchema);
