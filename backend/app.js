require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

// Route imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const branchRoutes = require('./routes/branchRoutes');
const tableRoutes = require('./routes/tableRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const customerRoutes = require('./routes/customerRoutes');
const billingRoutes = require('./routes/billingRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const menuRoutes = require('./routes/menuRoutes');
const reservationRoutes = require('./routes/reservationRoutes');
const {
  expenseRouter, bookingRouter, attendanceRouter, reportsRouter,
  logsRouter, notifRouter,
} = require('./routes/otherRoutes');
const settingsRouter = require('./routes/settingsRoute');

const errorHandler = require('./middleware/errorHandler');
const AppError = require('./utils/AppError');

const app = express();

// ── Trust proxy for Render deployment ─────────────────────────────────────────
app.set('trust proxy', true);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(mongoSanitize());

// Disable rate limiting in development for easier testing
if (process.env.NODE_ENV !== 'production') {
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10000, // 10,000 requests per minute in development
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true, // Required when app.set('trust proxy', true) is set
    message: { success: false, message: 'Too many requests. Please slow down.' },
  });
  app.use('/api/', limiter);
} else {
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true, // Required when app.set('trust proxy', true) is set
    message: { success: false, message: 'Too many requests. Please slow down.' },
  });
  app.use('/api/', limiter);
}

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CLIENT_URL 
  ? process.env.CLIENT_URL.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'];

console.log('🌐 CORS allowed origins:', allowedOrigins);
console.log('🌐 NODE_ENV:', process.env.NODE_ENV);
console.log('🌐 CLIENT_URL:', process.env.CLIENT_URL || 'not set');

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('🌐 CORS: Allowing request with no origin');
      return callback(null, true);
    }
    // Check if origin matches any allowed origin (with or without trailing slash)
    const normalizedOrigin = origin.replace(/\/$/, '');
    const normalizedAllowed = allowedOrigins.map(o => o.replace(/\/$/, ''));
    if (normalizedAllowed.includes(normalizedOrigin)) {
      console.log('🌐 CORS: Allowing origin:', origin);
      return callback(null, true);
    }
    console.log('🌐 CORS blocked origin:', origin, 'Allowed:', normalizedAllowed);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({ success: true, message: 'The Golden Frame API is running 🎱', timestamp: new Date() })
);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/bills', billingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/expenses', expenseRouter);
app.use('/api/bookings', bookingRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/notifications', notifRouter);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.all('*', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
