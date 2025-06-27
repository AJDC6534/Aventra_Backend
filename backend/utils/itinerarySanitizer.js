function sanitizeTime(time) {
  if (!time || typeof time !== 'string') return null;
  const match = time.match(/(\\d{1,2}):(\\d{2})/);
  if (match) {
    const [_, h, m] = match;
    const hours = parseInt(h);
    const minutes = parseInt(m);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }
  return null;
}

function sanitizeString(str) {
  return typeof str === 'string' ? str.trim().slice(0, 200) : null;
}

function sanitizeCost(cost, multiplier = 1) {
  if (typeof cost === 'number') return Math.max(0, Math.round(cost * multiplier));

  if (typeof cost === 'string') {
    const lower = cost.toLowerCase();
    if (lower.includes('free') || lower.includes('no cost') || lower === '0') return 0;

    const match = cost.match(/(\\d+)/);
    if (match) return Math.max(0, Math.round(parseInt(match[1]) * multiplier));

    if (lower.includes('variable') || lower.includes('varies')) {
      return Math.floor(Math.random() * 50 * multiplier) + 10;
    }
  }

  return Math.floor(Math.random() * 30 * multiplier) + 15;
}

function getDefaultActivity(interests, index) {
  const fallback = ['Explore area', 'Visit attraction', 'Cultural experience'];
  const defaults = {
    Culture: ['Museum visit', 'Historic site', 'Cultural tour'],
    Food: ['Local market', 'Street food', 'Cooking demo'],
    Nature: ['Hiking', 'Park visit', 'Scenic view'],
    Adventure: ['Zipline', 'Boat ride', 'Cliff hike'],
    History: ['Castle tour', 'Battlefield', 'Old town'],
    Art: ['Gallery', 'Public art walk', 'Workshop']
  };

  if (interests?.length) {
    const interest = interests[index % interests.length];
    return defaults[interest]?.[index % defaults[interest].length] || fallback[index % fallback.length];
  }

  return fallback[index % fallback.length];
}

function sanitizeAIItinerary(aiData, destination, expectedDays, budget, interests, pace) {
  if (!aiData || !Array.isArray(aiData.days)) return null;

  const budgetMultiplier = budget === 'budget' ? 0.5 : budget === 'luxury' ? 2 : 1;
  const startDate = new Date();
  const sanitizedDays = [];

  for (let i = 0; i < expectedDays; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);

    const aiDay = aiData.days[i] || { activities: [] };
    const activities = aiDay.activities || [];
    const sanitizedActivities = [];

    activities.forEach((a, idx) => {
      sanitizedActivities.push({
        time: sanitizeTime(a.time) || `${9 + idx * 2}:00`,
        activity: sanitizeString(a.activity) || 'Activity',
        location: sanitizeString(a.location) || `${destination} City Center`,
        duration: sanitizeString(a.duration) || '2 hours',
        cost: sanitizeCost(a.cost, budgetMultiplier),
        notes: sanitizeString(a.notes) || 'Have fun!'
      });
    });

    // Fill in minimum activities based on pace
    const min = pace === 'relaxed' ? 2 : pace === 'active' ? 4 : 3;
    while (sanitizedActivities.length < min) {
      const j = sanitizedActivities.length;
      sanitizedActivities.push({
        time: `${9 + j * 2}:00`,
        activity: getDefaultActivity(interests, j),
        location: `${destination} - Area ${j + 1}`,
        duration: '2 hours',
        cost: Math.floor(Math.random() * 30 * budgetMultiplier) + 10,
        notes: 'Enjoy your trip!'
      });
    }

    sanitizedDays.push({ date: currentDate.toISOString().split('T')[0], activities: sanitizedActivities });
  }

  return { days: sanitizedDays };
}

module.exports = {
  sanitizeAIItinerary,
  sanitizeTime,
  sanitizeCost,
  sanitizeString,
  getDefaultActivity
};
