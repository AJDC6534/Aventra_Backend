const express = require('express');
const router = express.Router();
const User = require('../models/User');
const UserActivity = require('../models/UserActivity');
const Itinerary = require('../models/Itinerary');
const authenticate = require('../middleware/auth');
const upload = require('../middleware/upload');

// Get profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const totalTrips = await Itinerary.countDocuments({ userId: req.user.userId });
    const completed = await Itinerary.find({ userId: req.user.userId, endDate: { $lt: new Date() } });

    const avgRating = completed.length
      ? completed.reduce((sum, t) => sum + (t.rating || 0), 0) / completed.length
      : 0;

    const daysTraveled = completed.reduce((sum, t) => {
      const days = Math.ceil((t.endDate - t.startDate) / (1000 * 60 * 60 * 24)) + 1;
      return sum + days;
    }, 0);

    await User.findByIdAndUpdate(req.user.userId, {
      totalTrips,
      avgRating: Math.round(avgRating * 10) / 10,
      daysTraveled
    });

    const updated = await User.findById(req.user.userId).select('-password');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching profile', error: err.message });
  }
});

// Update profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const updates = { ...req.body, updatedAt: Date.now() };

    const user = await User.findByIdAndUpdate(req.user.userId, updates, {
      new: true,
      runValidators: true
    }).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });

    await new UserActivity({
      userId: req.user.userId,
      type: 'profile_updated',
      title: 'Profile updated',
      description: 'User profile was updated',
      icon: '✏️'
    }).save();

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Profile update failed', error: err.message });
  }
});

// Upload profile picture
router.post('/profile-picture', authenticate, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const profilePicture = req.file.filename;
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { profilePicture, updatedAt: Date.now() },
      { new: true }
    ).select('-password');

    await new UserActivity({
      userId: req.user.userId,
      type: 'profile_picture_updated',
      title: 'Profile picture updated',
      description: 'User updated their profile picture',
      icon: '📷'
    }).save();

    res.json({ success: true, profilePicture });
  } catch (err) {
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

module.exports = router;
