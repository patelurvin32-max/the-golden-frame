require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(app);

// Keep HTTP connections alive — reduces TCP handshake overhead
server.keepAliveTimeout = 65000;    // 65s (above AWS/Render's 60s LB timeout)
server.headersTimeout = 66000;      // slightly above keepAliveTimeout

// ── Socket.io ─────────────────────────────────────────────────────────────────
const isLocalNetworkOrigin = (origin) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost')
    ) {
      return true;
    }

    if (
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    ) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
};

const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([
  ...configuredOrigins,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:4173',
]));

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/$/, '');
      const normalizedAllowed = allowedOrigins.map((o) => o.replace(/\/$/, ''));

      if (normalizedAllowed.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      if (process.env.NODE_ENV !== 'production' && isLocalNetworkOrigin(origin)) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by Socket.io CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  },
  transports: ['websocket', 'polling'],
});

// Attach io instance so controllers can emit events via req.app.get('io')
app.set('io', io);

io.on('connection', (socket) => {
  // Clients join user/role/branch rooms for real-time updates
  socket.on('join:user', ({ userId, role, branchId }) => {
    if (userId) socket.join(`user:${userId}`);
    if (role) socket.join(`role:${role}`);
    if (branchId) socket.join(`branch:${branchId}`);
  });

  // Clients join a branch room to receive live table updates
  socket.on('join:branch', (branchId) => {
    if (branchId) socket.join(`branch:${branchId}`);
  });

  socket.on('leave:branch', (branchId) => {
    if (branchId) socket.leave(`branch:${branchId}`);
  });
});

// ── Startup ───────────────────────────────────────────────────────────────────
const start = async () => {
  // Validate required environment variables
  const requiredEnvVars = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('Please set these in your .env file or production environment.');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('⚠️  Running in development mode with missing secrets. This is NOT secure!');
    }
  }

  await connectDB();

  try {
    const mongoose = require('mongoose');
    await mongoose.connection.collection('ordercounters').dropIndex('date_1');
    console.log('Successfully dropped old date_1 index from ordercounters');
  } catch (err) {
    // ignore
  }

  try {
    const mongoose = require('mongoose');
    await mongoose.connection.collection('orders').dropIndex('orderId_1');
    console.log('Successfully dropped old orderId_1 index from orders');
  } catch (err) {
    // ignore
  }

  try {
    const mongoose = require('mongoose');
    await mongoose.connection.collection('bills').dropIndex('invoiceNumber_1');
    console.log('Successfully dropped old invoiceNumber_1 index from bills');
  } catch (err) {
    // ignore
  }

  try {
    const mongoose = require('mongoose');
    await mongoose.connection.collection('reservations').dropIndex('reservationId_1');
    console.log('Successfully dropped old reservationId_1 index from reservations');
  } catch (err) {
    // ignore
  }

  try {
    const mongoose = require('mongoose');
    await mongoose.connection.collection('customers').dropIndex('customerId_1');
    console.log('Successfully dropped old customerId_1 index from customers');
  } catch (err) {
    // ignore
  }

  // Only seed in development OR when explicitly enabled via env var.
  // Without this gate, every production restart resets the super admin password.
  if (process.env.ENABLE_DEFAULT_SEED === 'true' || process.env.NODE_ENV !== 'production') {
    await seedDefaults();
  }

  // Run transaction history backfill/migration
  try {
    const backfillTransactions = require('./scripts/backfillTransactions');
    await backfillTransactions();
  } catch (err) {
    console.error('Failed to run transaction backfill on startup:', err);
  }

  const HOST = process.env.HOST || '0.0.0.0';

  server.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on port ${PORT}`);

    // ── Keep-alive: prevent Render free tier from sleeping ──────────────────
    // Render sleeps servers after 15 min of inactivity.
    // This pings the health endpoint every 14 minutes to keep it awake.
    if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
      const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes in ms

      setInterval(() => {
        const url = `${process.env.RENDER_EXTERNAL_URL}/api/health`;
        require('https').get(url, (res) => {
          console.log(`[keep-alive] ${new Date().toISOString()} — status: ${res.statusCode}`);
        }).on('error', (err) => {
          console.warn(`[keep-alive] Ping failed: ${err.message}`);
        });
      }, PING_INTERVAL);

      console.log(`✅ Keep-alive ping scheduled every 14 min → ${process.env.RENDER_EXTERNAL_URL}/api/health`);
    }
  });
};

// ── Default data seeder ───────────────────────────────────────────────────────
const seedDefaults = async () => {
  const User = require('./models/User');
  const Branch = require('./models/Branch');
  const Table = require('./models/Table');
  const { Settings } = require('./models/System');
  const { generateTableQRCode } = require('./services/qrCodeService');
  const { ROLES, DEFAULT_BRANCHES } = require('./config/constants');

  // Settings document (singleton)
  const settingsCount = await Settings.countDocuments();
  if (!settingsCount) {
    await Settings.create({ businessName: 'The Golden Frame', currency: 'INR', currencySymbol: '₹' });
  }

  // Create default branches if not present
  for (const branchName of DEFAULT_BRANCHES) {
    const code = branchName.toUpperCase().replace(/\s+/g, '');
    const exists = await Branch.findOne({ code });
    if (!exists) {
      try {
        await Branch.create({ name: branchName, code });
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
  }

  // Remove extra branches in dev if any exist
  if (process.env.NODE_ENV !== 'production') {
    const defaultCodes = DEFAULT_BRANCHES.map(name => name.toUpperCase().replace(/\s+/g, ''));
    const extraBranches = await Branch.find({ code: { $nin: defaultCodes } });
    if (extraBranches.length > 0) {
      for (const branch of extraBranches) {
        await Branch.findByIdAndDelete(branch._id);
      }
    }
  }

  // Super admin account
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@thegoldenframe.app';
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123456';

  const adminUser = await User.findOne({ email: adminEmail });
  if (adminUser) {
    adminUser.name = 'Super Admin';
    adminUser.password = adminPassword;
    adminUser.role = ROLES.SUPER_ADMIN;
    adminUser.isActive = true;
    await adminUser.save();
  } else {
    await User.create({
      name: 'Super Admin',
      email: adminEmail,
      password: adminPassword,
      role: ROLES.SUPER_ADMIN,
      isActive: true,
    });
  }


};

// ── Graceful shutdown ──────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.name, err.message);
  server.close(() => process.exit(1));
});

start();
