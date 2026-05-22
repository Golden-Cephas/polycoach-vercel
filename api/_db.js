// api/_db.js — shared MongoDB connection and all models
// Prefixed with _ so Vercel does not treat it as an API route

const mongoose = require("mongoose");

/* ══════════════════════════════════════
   CONNECTION — reuse across warm invocations
══════════════════════════════════════ */
let isConnected = false;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  isConnected = true;

  // Drop legacy unique index on regNumber if it exists
  try {
    await mongoose.connection.collection("users").dropIndex("regNumber_1");
  } catch (e) { /* already gone — fine */ }
}

/* ══════════════════════════════════════
   SCHEMAS & MODELS
══════════════════════════════════════ */
// Guard against model redefinition in serverless warm starts
function model(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

const User = model("User", new mongoose.Schema({
  fullName:    { type: String, required: true },
  phone:       { type: String, required: true, unique: true },
  busId:       { type: String, default: "bus1" },
  program:     { type: String, default: "" },
  destination: { type: String, default: "" },
  origin:      { type: String, default: "" },
  regNumber:   { type: String, default: null },
  password:    { type: String, default: null },
  studentID:   { type: String, default: null },
  createdAt:   { type: Date, default: Date.now }
}));

const Admin = model("Admin", new mongoose.Schema({
  fullName: String,
  phone:    { type: String, unique: true },
  password: String, // bcrypt hashed
}));

const Seat = model("Seat", new mongoose.Schema({
  number:        { type: Number, required: true },
  busId:         { type: String, default: "bus1" },
  status:        { type: String, enum: ["available","pending","booked"], default: "available" },
  passengerName: { type: String, default: null },
  destination:   { type: String, default: "" },
  origin:        { type: String, default: "" },
  phone:         { type: String, default: "" },
}));

const Booking = model("Booking", new mongoose.Schema({
  seatNumber:     Number,
  busId:          { type: String, default: "bus1" },
  passengerName:  String,
  destination:    String,
  origin:         { type: String, default: "" },
  phone:          { type: String, default: "" },
  program:        { type: String, default: "" },
  receiptNumber:  { type: String, default: "" },
  seatLabel:      { type: String, default: "" },
  deposit:        { type: String, default: "" },
  departureDate:  { type: String, default: "" },
  departureVenue: { type: String, default: "" },
  paymentProof:   { type: String, default: null },
  status:         { type: String, enum: ["pending","approved","rejected"], default: "pending" },
  createdAt:      { type: Date, default: Date.now }
}));

const Settings = model("Settings", new mongoose.Schema({
  bookingLabel:    { type: String, default: "Booking Fee" },
  bookingFee:      { type: String, default: "K5,000" },
  tripMode:        { type: String, default: "holiday" },
  bus1Name:        { type: String, default: "Bus 1" },
  bus2Name:        { type: String, default: "Bus 2" },
  bus1Venue:       { type: String, default: "MUBAS Main Gate" },
  bus2Venue:       { type: String, default: "MUBAS Main Gate" },
  bus1Date:        { type: String, default: "15 March 2025" },
  bus2Date:        { type: String, default: "15 March 2025" },
  bus1Time:        { type: String, default: "18:00 hrs" },
  bus2Time:        { type: String, default: "18:00 hrs" },
  payNationalBank: { type: String, default: "1012168938" },
  payAirtelMoney:  { type: String, default: "0999 261 665" },
  payTNMMpamba:    { type: String, default: "0881 730 203" },
  payAccountName:  { type: String, default: "PETROS MWAKHWAWA" },
}));

/* ══════════════════════════════════════
   SEED — runs once when collection empty
══════════════════════════════════════ */
const bcrypt = require("bcrypt");

const DEFAULT_ADMINS = [
  { phone: "0981136268", password: "Golden Cephas", fullName: "Golden Cephas" },
  { phone: "0881730203", password: "soyo1234",      fullName: "Emmanuel Soyo"  }
];

async function seedIfNeeded() {
  // Seats — 72 per bus
  const seatCount = await Seat.countDocuments();
  if (seatCount === 0) {
    const seats = [];
    for (let i = 1; i <= 72; i++) seats.push({ number: i, busId: "bus1" });
    for (let i = 1; i <= 72; i++) seats.push({ number: i, busId: "bus2" });
    await Seat.insertMany(seats);
  } else if (seatCount === 72) {
    // Migrate existing seats to bus1, add bus2 seats
    await Seat.updateMany({ busId: { $exists: false } }, { $set: { busId: "bus1" } });
    const bus2Count = await Seat.countDocuments({ busId: "bus2" });
    if (bus2Count === 0) {
      const seats = [];
      for (let i = 1; i <= 72; i++) seats.push({ number: i, busId: "bus2" });
      await Seat.insertMany(seats);
    }
  }
  // Admins
  for (const a of DEFAULT_ADMINS) {
    if (!await Admin.findOne({ phone: a.phone })) {
      await Admin.create({
        fullName: a.fullName,
        phone: a.phone,
        password: await bcrypt.hash(a.password, 10)
      });
    }
  }
  // Settings
  if (await Settings.countDocuments() === 0) {
    await Settings.create({});
  }
}

module.exports = { connectDB, seedIfNeeded, User, Admin, Seat, Booking, Settings, DEFAULT_ADMINS };
