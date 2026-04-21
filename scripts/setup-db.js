#!/usr/bin/env node

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set — skipping database setup.');
  process.exit(0);
}

console.log('Setting up database...');

function hasMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  return (
    fs.existsSync(migrationsDir) &&
    fs.readdirSync(migrationsDir).some((entry) =>
      fs.statSync(path.join(migrationsDir, entry)).isDirectory()
    )
  );
}

try {
  console.log('Generating Prisma client...');
  execSync('yarn db:generate', { stdio: 'inherit' });

  if (hasMigrations()) {
    console.log('Migration files found — running prisma migrate deploy...');
    execSync('yarn db:migrate:prod', { stdio: 'inherit' });
  } else {
    console.log('No migration files found — running prisma db push...');
    execSync('yarn db:push', { stdio: 'inherit' });
  }

  console.log('Database setup complete.');
  process.exit(0);
} catch (error) {
  console.error('Database setup failed:', error.message);
  process.exit(1);
}
