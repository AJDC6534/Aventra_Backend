const rateLimiter = {
  requests: new Map(),
  maxRequests: 15,
  windowMs: 60000, // 1 minute

  isAllowed(userId) {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const validRequests = userRequests.filter(ts => now - ts < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    validRequests.push(now);
    this.requests.set(userId, validRequests);
    return true;
  }
};

module.exports = rateLimiter;
