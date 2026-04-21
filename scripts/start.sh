#!/bin/sh

set -e

echo "Setting up database..."
node scripts/setup-db.js

echo "Starting server..."
yarn start
