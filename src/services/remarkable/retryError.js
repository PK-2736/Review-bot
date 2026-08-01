class RetryableError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {string} [details.source]
   * @param {boolean} [details.transient]
   * @param {any} [details.originalError]
   * @param {any} [details.details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'RetryableError';
    this.isRetryable = true;
    this.source = details.source || null;
    this.transient = details.transient !== false;
    this.originalError = details.originalError;
    this.details = details.details;
  }
}

function isRetryableError(error) {
  return Boolean(error && error.isRetryable === true);
}

module.exports = {
  RetryableError,
  isRetryableError,
};
