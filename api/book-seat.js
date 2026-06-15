// api/book-seat.js — POST /api/book-seat
const { connectDB, Seat, Booking, User, Settings } = require("./_db");
const { setHeaders } = require("./_auth");

function buildReceiptNumber(seatLabel, phone, date, count) {
  const d = date || new Date();
  const dd   = String(d.getDate()).padStart(2,"0");
  const mm   = String(d.getMonth()+1).padStart(2,"0");
  const yy   = String(d.getFullYear()).slice(-2);
  const last6 = String(phone||"").replace(/\D/g,"").slice(-6);
  const seq   = String(count).padStart(2,"0");
  return `${seatLabel}-${dd}${mm}${yy}${last6}-${seq}`;
}

function getSeatLabel(num) {
  if (num >= 66) return "BR" + (num - 65);
  const row = Math.ceil(num / 5);
  const pos = num - (row - 1) * 5;
  return row + ["A","B","C","D","E"][pos - 1];
}

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();

  const {
    seatNumber, busId = "bus1", passengerName, destination, origin,
    phone, program, paymentProof, releaseOldSeat
  } = req.body;

  if (!seatNumber || !passengerName)
    return res.json({ success: false, message: "Seat number and passenger name are required." });

  try {
    // If switching — release the old seat and booking
    if (releaseOldSeat) {
      await Seat.findOneAndUpdate(
        { number: releaseOldSeat, busId },
        { status: "available", passengerName: null, destination: "", origin: "", phone: "", paymentProof: null }
      );
      await Booking.findOneAndUpdate(
        { seatNumber: releaseOldSeat, busId, status: { $in: ["pending","approved"] } },
        { status: "rejected" }
      );
    }

    // Check target seat is still available
    const seat = await Seat.findOne({ number: seatNumber, busId });
    if (!seat) return res.json({ success: false, message: "Seat not found." });
    if (seat.status !== "available")
      return res.json({ success: false, message: "Seat " + seatNumber + " is no longer available." });

    const settings  = await Settings.findOne();
    const proofUrl  = paymentProof || localStorage?.getItem?.("paymentProofUrl") || null;
    const today     = new Date();
    const todayCount = await Booking.countDocuments({
      createdAt: { $gte: new Date(today.toDateString()) }, busId
    });
    const seatLabel = getSeatLabel(seatNumber);

    // Mark seat pending
    seat.status        = "pending";
    seat.passengerName = passengerName;
    seat.destination   = destination || "";
    seat.origin        = origin || "";
    seat.phone         = phone || "";
    seat.paymentProof  = proofUrl || null;
    await seat.save();

    // Create booking
    const booking = await Booking.create({
      seatNumber,
      busId,
      passengerName,
      destination:    destination || "",
      origin:         origin || "",
      phone:          phone || "",
      program:        program || "",
      seatLabel,
      departureDate:  settings ? (settings[busId+"Date"]  || settings.departureDate  || "") : "",
      departureVenue: settings ? (settings[busId+"Venue"] || settings.departureVenue || "") : "",
      deposit:        settings ? settings.bookingFee : "K5,000",
      paymentProof:   proofUrl || null,
      status:         "pending"
    });

    return res.json({ success: true, bookingId: booking._id });
  } catch (err) {
    console.error("book-seat error:", err.message);
    return res.json({ success: false, message: "Booking failed. Please try again." });
  }
};
