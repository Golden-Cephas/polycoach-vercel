// api/seats.js — GET /api/seats?busId=bus1
const { connectDB, seedIfNeeded, Seat } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  await connectDB();
  await seedIfNeeded();
  try {
    const busId = req.query.busId || "bus1";
    const seats = await Seat.find({ busId }).sort({ number: 1 });
    res.json(seats);
  } catch (err) {
    console.error("seats error:", err.message);
    res.json([]);
  }
};
