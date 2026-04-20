const { connectDB, Seat, Booking, User } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();
  const { seatNumber, passengerName, destination, phone, program, paymentProof } = req.body;
  if (!seatNumber || !passengerName)
    return res.status(400).json({ success: false, message: "Missing seat or passenger name." });
  const seatNum = Number(seatNumber);
  if (isNaN(seatNum) || seatNum < 1 || seatNum > 72)
    return res.status(400).json({ success: false, message: "Invalid seat number." });
  try {
    const seat = await Seat.findOne({ number: seatNum });
    if (!seat)
      return res.status(404).json({ success: false, message: "Seat not found." });
    if (seat.status !== "available")
      return res.status(409).json({ success: false, message: "Seat already taken. Please choose another." });
    seat.status        = "pending";
    seat.passengerName = passengerName;
    seat.destination   = destination || "";
    seat.phone         = phone || "";
    await seat.save();
    await Booking.create({
      seatNumber:    seatNum,
      passengerName,
      destination:   destination || "",
      phone:         phone || "",
      program:       program || "",
      paymentProof:  paymentProof || null,
      status:        "pending"
    });
    res.json({ success: true });
  } catch (err) {
    console.error("book-seat error:", err.message);
    res.status(500).json({ success: false, message: "Booking failed. Please try again." });
  }
};
