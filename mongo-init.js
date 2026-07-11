// mongo-init.js — Runs once on first container launch
// Creates a dedicated DB user for the app (root creds are for admin only)

db = db.getSiblingDB('thegoldenframe');

db.createUser({
  user: 'thegoldenframe_app',
  pwd: 'thegoldenframe_app_2024',
  roles: [{ role: 'readWrite', db: 'thegoldenframe' }],
});

// Create initial indexes (Mongoose handles this too, but good to have here)
db.createCollection('users');
db.createCollection('branches');
db.createCollection('tables');
db.createCollection('sessions');
db.createCollection('bills');
db.createCollection('payments');
db.createCollection('customers');
db.createCollection('bookings');
db.createCollection('inventory');
db.createCollection('expenses');
db.createCollection('attendance');
db.createCollection('notifications');
db.createCollection('activitylogs');
db.activitylogs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
db.activitylogs.createIndex({ branch: 1, createdAt: -1 });
db.activitylogs.createIndex({ action: 1, description: 1 });
db.createCollection('settings');
db.createCollection('membershipplans');

print('✅ The Golden Frame database initialized');
