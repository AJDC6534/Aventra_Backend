const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const Itinerary = require('../models/Itinerary');
const UserActivity = require('../models/UserActivity');
const rateLimiter = require('../middleware/rateLimiter');
const genAI = require('../config/gemini');
const { sanitizeAIItinerary } = require('../utils/itinerarySanitizer');
const generateMockItinerary = require('../utils/mockGenerator');

// Create itinerary (manual or AI)
router.post('/', authenticate, async (req, res) => {
  try {
    const { destination, startDate, endDate, interests, budget, pace } = req.body;
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

    let useAI = false;
    let generatedItinerary;

    const withinLimit = rateLimiter.isAllowed(req.user.userId);
    const hasKey = !!genAI;

    if (hasKey && withinLimit) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(`Generate a ${days}-day travel itinerary for ${destination}...`);
        const response = await result.response;
        const raw = response.text().replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(raw);
        const sanitized = sanitizeAIItinerary(parsed, destination, days, budget, interests, pace);
        if (!sanitized) throw new Error('Invalid AI output');
        generatedItinerary = sanitized;
        useAI = true;
      } catch (e) {
        generatedItinerary = generateMockItinerary(destination, days, interests, budget, pace);
      }
    } else {
      generatedItinerary = generateMockItinerary(destination, days, interests, budget, pace);
    }

    const itinerary = new Itinerary({
      userId: req.user.userId,
      title: `${useAI ? 'AI-Generated' : 'Custom'} Trip to ${destination}`,
      destination,
      startDate,
      endDate,
      preferences: { interests, pace },
      budget: budget === 'budget' ? 500 : budget === 'luxury' ? 3000 : 1500,
      days: generatedItinerary.days,
      aiGenerated: useAI
    });

    await itinerary.save();
    res.status(201).json(itinerary);
  } catch (err) {
    res.status(500).json({ message: 'Error generating itinerary', error: err.message });
  }
});

// Get all itineraries
router.get('/', authenticate, async (req, res) => {
  const itineraries = await Itinerary.find({ userId: req.user.userId }).sort({ createdAt: -1 });
  res.json(itineraries);
});

// Get one itinerary
router.get('/:id', authenticate, async (req, res) => {
  const itinerary = await Itinerary.findOne({ _id: req.params.id, userId: req.user.userId });
  if (!itinerary) return res.status(404).json({ message: 'Not found' });
  res.json(itinerary);
});

// Update
router.put('/:id', authenticate, async (req, res) => {
  const itinerary = await Itinerary.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.userId },
    { ...req.body, updatedAt: Date.now() },
    { new: true }
  );
  res.json(itinerary);
});

// Delete
router.delete('/:id', authenticate, async (req, res) => {
  await Itinerary.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
  res.json({ message: 'Deleted' });
});

module.exports = router;
