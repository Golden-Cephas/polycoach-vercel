const { connectDB, seedIfNeeded, Seat, Booking } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  await connectDB();
  await seedIfNeeded();

  // ?booking=seatNumber — returns booking details for QR verification
  if (req.query && req.query.booking) {
    const seatNum = Number(req.query.booking);
    try {
      const booking = await Booking.findOne({
        seatNumber: seatNum,
        status: { $ne: "rejected" }
      }).sort({ createdAt: -1 });
      if (!booking) return res.json({ found: false });
      return res.json({
        found:          true,
        passengerName:  booking.passengerName  || "",
        destination:    booking.destination    || "",
        departureDate:  booking.departureDate  || "",
        departureVenue: booking.departureVenue || "",
        seatNumber:     booking.seatNumber,
        status:         booking.status,
        createdAt:      booking.createdAt
      });
    } catch { return res.json({ found: false }); }
  }

  // Default — return all seats
  try {
    const seats = await Seat.find().sort({ number: 1 });
    res.json(seats);
  } catch { res.json([]); }
};
