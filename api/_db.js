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

  // Create the (number, busId) unique index on seats. This will fail
  // (and just get caught) until any existing duplicate seats are removed —
  // once they are, this succeeds and locks in protection going forward.
  try {
    await Seat.createIndexes();
  } catch (e) { /* duplicates still present, or index already exists — fine */ }
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

const seatSchema = new mongoose.Schema({
  number:        { type: Number, required: true },
  busId:         { type: String, default: "bus1" },
  status:        { type: String, enum: ["available","pending","booked"], default: "available" },
  passengerName: { type: String, default: null },
  destination:   { type: String, default: "" },
  origin:        { type: String, default: "" },
  phone:         { type: String, default: "" },
  paymentProof:  { type: String, default: null },
});
// Without this, nothing stops two concurrent requests from each seeding a
// full set of seats for the same bus — which is exactly what happened to
// Bus 2 (every seat number ended up with 2 documents).
seatSchema.index({ number: 1, busId: 1 }, { unique: true });
const Seat = model("Seat", seatSchema);

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
  // Drop old unique index on number (pre-two-bus) — safe to call repeatedly
  try {
    await mongoose.connection.collection("seats").dropIndex("number_1");
  } catch(e) { /* already dropped — fine */ }

  // Seats — 72 per bus
  const untagged  = await Seat.countDocuments({ busId: { $exists: false } });

  // Tag any untagged seats as bus1
  if (untagged > 0) {
    await Seat.updateMany({ busId: { $exists: false } }, { $set: { busId: "bus1" } });
  }

  // Fill in any missing seat numbers (1-72) for each bus. A cheap count check
  // first avoids doing per-number work on every single request — the heavier
  // gap-finding logic only runs if a bus doesn't already have all 72 seats.
  for (const bus of ["bus1", "bus2"]) {
    const count = await Seat.countDocuments({ busId: bus });
    if (count >= 72) continue;

    const existing = await Seat.find({ busId: bus }).select("number").lean();
    const have = new Set(existing.map(s => s.number));
    const missingNumbers = [];
    for (let i = 1; i <= 72; i++) {
      if (!have.has(i)) missingNumbers.push(i);
    }
    if (missingNumbers.length === 0) continue;

    // A missing seat may still have a real Booking against it — recover
    // that data so the healed seat shows its true pending/booked state
    // instead of defaulting to blank "available".
    const bookingsForGaps = await Booking.find({
      busId: bus,
      seatNumber: { $in: missingNumbers },
      status: { $ne: "rejected" }
    }).lean();
    const bookingBySeat = {};
    bookingsForGaps.forEach(b => { bookingBySeat[b.seatNumber] = b; });

    // Upsert one at a time (not insertMany) so two concurrent requests can
    // never both insert the same seat number — the unique index plus this
    // upsert pattern together make duplicate seats structurally impossible.
    for (const num of missingNumbers) {
      const b = bookingBySeat[num];
      const seatData = !b ? { number: num, busId: bus } : {
        number:        num,
        busId:         bus,
        status:        b.status === "approved" ? "booked" : "pending",
        passengerName: b.passengerName || null,
        destination:   b.destination || "",
        origin:        b.origin || "",
        phone:         b.phone || ""
      };
      try {
        await Seat.updateOne(
          { number: num, busId: bus },
          { $setOnInsert: seatData },
          { upsert: true }
        );
      } catch (e) { /* another concurrent request already created it — fine */ }
    }
  }
  // Migrate existing bookings and users to bus1
  await Booking.updateMany({ busId: { $exists: false } }, { $set: { busId: "bus1" } });
  await User.updateMany({ busId: { $exists: false } }, { $set: { busId: "bus1" } });

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
