require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CLIENT_URL 
  ? process.env.CLIENT_URL.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Attach io instance so controllers can emit events via req.app.get('io')
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Clients join a branch room to receive live table updates
  socket.on('join:branch', (branchId) => {
    socket.join(`branch:${branchId}`);
    console.log(`   Socket ${socket.id} joined branch room: ${branchId}`);
  });

  socket.on('leave:branch', (branchId) => {
    socket.leave(`branch:${branchId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// ── Startup ───────────────────────────────────────────────────────────────────
const start = async () => {
  await connectDB();

  // Seed default data on first run
  await seedDefaults();

  server.listen(PORT, () => {
    console.log(`\n🎱 The Golden Frame API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
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
    console.log('⚙️  Default settings created.');
  }

  // Create default branches
  for (const branchName of DEFAULT_BRANCHES) {
    const code = branchName.toUpperCase().replace(/\s+/g, '');
    const exists = await Branch.findOne({ code });
    if (!exists) {
      try {
        await Branch.create({ name: branchName, code });
        console.log(`🏢 Branch created: ${branchName}`);
      } catch (err) {
        if (err.code === 11000) {
          console.log(`⚠️  Branch already exists: ${branchName}`);
        } else {
          throw err;
        }
      }
    }
  }

  const starterTables = [
    { name: 'Pool 1', type: 'pool', hourlyRate: 300 },
    { name: 'Snooker 1', type: 'snooker', hourlyRate: 400 },
    { name: 'PS5 1', type: 'ps5', hourlyRate: 200 },
  ];

  const seededBranches = await Branch.find({ name: { $in: DEFAULT_BRANCHES } });
  for (const branch of seededBranches) {
    for (const tableDef of starterTables) {
      const tableExists = await Table.findOne({ branch: branch._id, name: tableDef.name });
      if (tableExists) continue;

      const table = await Table.create({
        ...tableDef,
        branch: branch._id,
      });

      table.qrCode = await generateTableQRCode(table._id);
      await table.save();

      console.log(`🎱 Table created: ${table.name} @ ${branch.name}`);
    }
  }

  // Super admin account (created/updated if env vars are set, otherwise only created if none exists)
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@thegoldenframe.app';
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123456';
  
  if (process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
    // If env vars are set, always update/create the admin user
    await User.findOneAndUpdate(
      { email: adminEmail },
      {
        name: 'Super Admin',
        email: adminEmail,
        password: adminPassword,
        role: ROLES.SUPER_ADMIN,
        isActive: true,
      },
      { upsert: true, new: true }
    );
    console.log(`👑 Super admin ensured: ${adminEmail}`);
  } else {
    // If env vars are not set, only create if none exists
    const adminExists = await User.findOne({ role: ROLES.SUPER_ADMIN });
    if (!adminExists) {
      await User.create({
        name: 'Super Admin',
        email: adminEmail,
        password: adminPassword,
        role: ROLES.SUPER_ADMIN,
      });
      console.log(`👑 Super admin created: ${adminEmail}`);
      console.log('   ⚠️  Change the default password immediately!\n');
    }
  }

  // Seed default categories
  const InventoryCategory = require('./models/InventoryCategory');
  const { Inventory } = require('./models/Operations');

  const defaultCats = [
    'Cue Sticks',
    'Cue Tips',
    'Balls',
    'Chalk',
    'Gloves',
    'Food',
    'Cold Drinks',
    'Snacks',
    'Other'
  ];

  for (const catName of defaultCats) {
    const exists = await InventoryCategory.findOne({ name: catName });
    if (!exists) {
      await InventoryCategory.create({ name: catName, status: 'Active' });
      console.log(`🏷️  Category created: ${catName}`);
    }
  }

  // Auto-migrate old string-based categories to dynamic category refs
  const itemsWithOldCategory = await Inventory.find({ category: { $not: { $type: 'objectId' } } });
  if (itemsWithOldCategory.length > 0) {
    console.log(`🔄 Migrating ${itemsWithOldCategory.length} inventory items to dynamic category refs...`);
    for (const item of itemsWithOldCategory) {
      let mappedName = 'Other';
      const rawCategory = String(item.category || '');
      if (rawCategory === 'cue_stick') mappedName = 'Cue Sticks';
      else if (rawCategory === 'cue_tips') mappedName = 'Cue Tips';
      else if (rawCategory === 'balls') mappedName = 'Balls';
      else if (rawCategory === 'chalk') mappedName = 'Chalk';
      else if (rawCategory === 'gloves') mappedName = 'Gloves';
      else if (rawCategory === 'food') mappedName = 'Food';
      else if (rawCategory === 'cold_drinks') mappedName = 'Cold Drinks';
      else if (rawCategory === 'snacks') mappedName = 'Snacks';
      else if (rawCategory === 'other') mappedName = 'Other';
      else mappedName = rawCategory || 'Other';

      let catDoc = await InventoryCategory.findOne({ name: mappedName });
      if (!catDoc) {
        catDoc = await InventoryCategory.create({ name: mappedName, status: 'Active' });
      }
      item.category = catDoc._id;
      await item.save();
    }
    console.log('✅ Inventory migration completed.');
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
