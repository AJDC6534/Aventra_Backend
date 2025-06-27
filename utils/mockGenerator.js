const { getDefaultActivity } = require('./itinerarySanitizer');

function generateMockItinerary(destination, days, interests, budget, pace) {
  const budgetMultiplier = budget === 'budget' ? 0.6 : budget === 'luxury' ? 2.5 : 1;
  const count = pace === 'relaxed' ? 2 : pace === 'active' ? 4 : 3;

  const output = [];

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    const activities = [];
    for (let j = 0; j < count; j++) {
      const hour = 9 + j * 2;
      activities.push({
        time: `${hour.toString().padStart(2, '0')}:00`,
        activity: getDefaultActivity(interests, j),
        location: `${destination} - Area ${j + 1}`,
        duration: pace === 'relaxed' ? '3 hours' : '1.5 hours',
        cost: Math.round((20 + j * 10) * budgetMultiplier),
        notes: 'Check availability and enjoy!'
      });
    }

    output.push({
      date: date.toISOString().split('T')[0],
      activities
    });
  }

  return { days: output };
}

module.exports = generateMockItinerary;
