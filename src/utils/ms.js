'use strict';

/**
 * Tiny duration parser: converts strings like "7d", "15m", "1h", "30s" to milliseconds.
 */
const UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function ms(str) {
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) throw new Error(`Invalid duration: "${str}"`);
  return parseInt(match[1], 10) * UNITS[match[2]];
}

module.exports = ms;
