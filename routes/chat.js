const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const genAI = require('../config/gemini');
const rateLimiter = require('../middleware/rateLimiter');
const Chat = require('../models/Chat');
const Itinerary = require('../models/Itinerary');
const User = require('../models/User');

const mockResponse = (msg) => `You asked about: "${msg}". Here's a sample tip: ✨ Always plan ahead and stay flexible!`;

router.post('/', authenticate, async (req, res) => {
  try {
    const { message, itineraryId } = req.body;
    if (!message) return res.status(400).json({ message: 'Message required' });

    let responseText = '';
    const user = await User.findById(req.user.userId);
    const itinerary = itineraryId ? await Itinerary.findById(itineraryId) : null;

    const canAI = genAI && rateLimiter.isAllowed(req.user.userId);
    if (canAI) {
      try {
        const context = `Help a user plan a trip. Question: ${message}`;
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(context);
        const ai = await result.response;
        responseText = ai.text();
      } catch {
        responseText = mockResponse(message);
      }
    } else {
      responseText = mockResponse(message);
    }

    const chat = await Chat.findOneAndUpdate(
      { userId: req.user.userId, itineraryId: itineraryId || null },
      { $push: { messages: [{ role: 'user', content: message }, { role: 'assistant', content: responseText }] } },
      { new: true, upsert: true }
    );

    res.json({ response: responseText, provider: canAI ? 'gemini' : 'mock' });
  } catch (err) {
    res.status(500).json({ message: 'Chat error', error: err.message });
  }
});

router.get('/:itineraryId?', authenticate, async (req, res) => {
  const chat = await Chat.findOne({
    userId: req.user.userId,
    itineraryId: req.params.itineraryId || null
  });

  res.json(chat ? chat.messages : []);
});

module.exports = router;
