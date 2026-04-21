'use strict';

require('./config/env'); // validate env vars on startup
const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');

async function main() {
  await prisma.$connect();
  console.log('Database connected');

  app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
