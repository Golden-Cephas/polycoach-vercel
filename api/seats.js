const { connectDB, seedIfNeeded, Seat } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  await connectDB();
  await seedIfNeeded();
  try {
    const seats = await Seat.find().sort({ number: 1 });
    res.json(seats);
  } catch { res.json([]); }
};
