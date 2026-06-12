'use strict';

const USERNAME_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

function isValidUsername(username) {
  return typeof username === 'string'
    && username.length <= 64
    && USERNAME_RE.test(username);
}

module.exports = { isValidUsername };
