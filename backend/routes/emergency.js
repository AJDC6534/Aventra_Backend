const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const User = require('../models/User');
const CheckIn = require('../models/CheckIn');
const EmergencyAlert = require('../models/EmergencyAlert');
const UserActivity = require('../models/UserActivity');

// Update location
router.put('/location', authenticate, async (req, res) => {
  const { latitude, longitude, address, accuracy } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ message: 'Coordinates required' });

  const location = {
    latitude,
    longitude,
    address: address || `${latitude}, ${longitude}`,
    accuracy: accuracy || 0,
    timestamp: new Date()
  };

  const user = await User.findByIdAndUpdate(req.user.userId, { currentLocation: location }, { new: true });
  res.json({ success: true, location: user.currentLocation });
});

// Check-in
router.post('/check-in', authenticate, async (req, res) => {
  const { location, status = 'safe', message, automatic = false } = req.body;

  if (!location?.latitude || !location?.longitude)
    return res.status(400).json({ message: 'Location required' });

  const checkIn = new CheckIn({
    userId: req.user.userId,
    location,
    status,
    message,
    automatic
  });

  await checkIn.save();
  await User.findByIdAndUpdate(req.user.userId, { currentLocation: { ...location, timestamp: new Date() } });

  await new UserActivity({
    userId: req.user.userId,
    type: 'check_in',
    title: automatic ? 'Automatic Check-in' : 'Manual Check-in',
    description: `Checked in from ${location.address || 'GPS location'}`,
    icon: '✅'
  }).save();

  res.json({ success: true, checkIn });
});

// Emergency alert
router.post('/alert', authenticate, async (req, res) => {
  const { type, location, emergencyContacts, message } = req.body;

  if (!emergencyContacts?.length)
    return res.status(400).json({ message: 'Emergency contacts required' });

  const alert = new EmergencyAlert({
    userId: req.user.userId,
    alertType: type || 'other',
    location,
    message,
    emergencyContacts
  });

  await alert.save();

  await new UserActivity({
    userId: req.user.userId,
    type: 'emergency_alert',
    title: '🚨 Emergency Alert',
    description: 'Emergency alert sent',
    icon: '🚨'
  }).save();

  res.json({ success: true, alertId: alert._id });
});

module.exports = router;
