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

    // Check target seat is still available — but allow if this user already owns it (pending from registration)
    const seat = await Seat.findOne({ number: seatNumber, busId });
    if (!seat) return res.json({ success: false, message: "Seat not found." });
    const ownsSeat = seat.status === "pending" &&
                     (seat.phone || "").trim() === (phone || "").trim();
    if (seat.status !== "available" && !ownsSeat)
      return res.json({ success: false, message: "Seat " + seatNumber + " is no longer available." });

    const settings   = await Settings.findOne();
    const mode       = (settings && settings.tripMode) || "holiday";
    const isHoliday  = mode !== "backtoschool";

    // Same convention as register.js: collapse origin/destination into the
    // single field the dashboard reads, based on current trip mode.
    // Holiday: common venue is the origin (From), student-picked town is destination (To)
    // Back-to-school: student-picked town is origin (From), common venue is destination (To)
    const resolvedOrigin      = isHoliday
      ? (settings && (settings[busId+"Venue"] || settings.departureVenue) || "")
      : (origin || "");
    const resolvedDestination = isHoliday
      ? (destination || "")
      : (settings && (settings[busId+"Venue"] || settings.departureVenue) || "");

    const proofUrl   = paymentProof || null;
    const seatLabel  = getSeatLabel(seatNumber);

    // Update seat record
    seat.status        = "pending";
    seat.passengerName = passengerName;
    seat.destination   = resolvedDestination;
    seat.origin        = resolvedOrigin;
    seat.phone         = phone || "";
    seat.paymentProof  = proofUrl || seat.paymentProof || null;
    await seat.save();

    // Update existing booking if one exists for this phone+busId, otherwise create
    const existingBooking = await Booking.findOne({
      phone: (phone || "").trim(),
      busId,
      status: { $in: ["pending", "approved"] }
    });

    const bookingData = {
      seatNumber,
      busId,
      passengerName,
      destination:    resolvedDestination,
      origin:         resolvedOrigin,
      phone:          phone || "",
      program:        program || "",
      seatLabel,
      departureDate:  settings ? (settings[busId+"Date"]  || settings.departureDate  || "") : "",
      departureVenue: settings ? (settings[busId+"Venue"] || settings.departureVenue || "") : "",
      deposit:        settings ? settings.bookingFee : "K5,000",
      paymentProof:   proofUrl || (existingBooking ? existingBooking.paymentProof : null) || null,
      status:         "pending"
    };

    let booking;
    if (existingBooking) {
      Object.assign(existingBooking, bookingData);
      booking = await existingBooking.save();
    } else {
      booking = await Booking.create(bookingData);
    }

    return res.json({ success: true, bookingId: booking._id });
  } catch (err) {
    console.error("book-seat error:", err.message);
    return res.json({ success: false, message: "Booking failed. Please try again." });
  }
};
