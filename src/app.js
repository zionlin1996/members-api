'use strict';

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const memberRoutes = require('./routes/member.routes');
const adminRoutes = require('./routes/admin.routes');
const oidcRoutes = require('./routes/oidc.routes');
const { errorHandler } = require('./middleware/error.middleware');

const app = express();

// Credentialed CORS: the browser sends/receives the httpOnly refresh cookie, so
// the response must echo a specific origin (not *) and allow credentials.
const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/.well-known', oidcRoutes);
app.use('/auth', authRoutes);
app.use('/members', memberRoutes);
app.use('/admin', adminRoutes);

app.use(errorHandler);

module.exports = app;
