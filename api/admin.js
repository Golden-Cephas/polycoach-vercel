// api/admin.js — ALL admin operations in one serverless function
// Route via ?action= query parameter
// Examples:
//   GET  /api/admin?action=users&busId=bus1
//   GET  /api/admin?action=bookings&busId=bus1
//   GET  /api/admin?action=seats&busId=bus1
//   GET  /api/admin?action=settings
//   POST /api/admin?action=approve&id=xxx
//   POST /api/admin?action=reject&id=xxx
//   POST /api/admin?action=delete-booking&id=xxx
//   POST /api/admin?action=add-booking
//   POST /api/admin?action=delete-user&id=xxx
//   POST /api/admin?action=add-user
//   POST /api/admin?action=edit-seat&num=xx&busId=bus1
//   POST /api/admin?action=reset-seats&busId=bus1
//   POST /api/admin?action=save-settings
//   POST /api/admin?action=change-password
//   POST /api/admin?action=reset-admin-password
//   POST /api/admin?action=register-passenger
//   GET  /api/admin?action=proof&id=xxx
//   GET  /api/admin?action=receipt&id=xxx
//   GET  /api/admin?action=studentid&id=xxx

const { connectDB, seedIfNeeded, User, Admin, Seat, Booking, Settings } = require("./_db");

// Safe seat label: 1A-1E per row, BR1-BR7 for back row
function makeSeatLabel(n){
  if(n >= 66) return "BR" + (n - 65);
  const row = Math.ceil(n / 5);
  const col = n - (row - 1) * 5;
  return row + ["A","B","C","D","E"][col - 1];
}

// Safe receipt number — X-Y-Z
async function buildReceiptNumber(seatNum, phone, Booking){
  const lbl = makeSeatLabel(seatNum);
  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2,"0");
  const mm   = String(now.getMonth()+1).padStart(2,"0");
  const yy   = String(now.getFullYear()).slice(-2);
  const digits = String(phone||"").replace(/[^0-9]/g,"");
  const l6     = digits.length >= 6 ? digits.slice(-6) : digits.padStart(6,"0");
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const cnt = await Booking.countDocuments({ createdAt:{ $gte: todayStart } });
  const Z   = String(cnt + 1).padStart(2,"0");
  return { receiptNumber: lbl+"-"+dd+mm+yy+l6+"-"+Z, seatLabel: lbl };
}

const { setHeaders, requireAdmin } = require("./_auth");
const bcrypt = require("bcrypt");

const DEFAULT_PASSWORDS = {
  "0981136268": "Golden Cephas",
  "0881730203": "soyo1234"
};

// Auto-delete bookings 48h after their departure date
async function cleanExpiredBookings() {
  try {
    const bookings = await Booking.find({ departureDate: { $ne: "" } }).lean();
    for (const b of bookings) {
      if (!b.departureDate) continue;
      const dep = new Date(b.departureDate);
      if (isNaN(dep.getTime())) continue;
      const expiry = new Date(dep.getTime() + 48 * 60 * 60 * 1000);
      if (new Date() > expiry) {
        await Booking.findByIdAndDelete(b._id);
        await Seat.findOneAndUpdate(
          { number: b.seatNumber, busId: b.busId||"bus1" },
          { status: "available", passengerName: null, destination: "", origin: "", phone: "" }
        );
      }
    }
  } catch(e) { console.error("Cleanup error:", e.message); }
}

// Helper: get bus-specific settings fields
function getBusSettings(settings, busId) {
  const b = busId === "bus2" ? "bus2" : "bus1";
  return {
    busName:       settings[b+"Name"]  || (b === "bus1" ? "Bus 1" : "Bus 2"),
    departureDate: settings[b+"Date"]  || settings.departureDate  || "",
    departureTime: settings[b+"Time"]  || settings.departureTime  || "",
    departureVenue:settings[b+"Venue"] || settings.departureVenue || "",
    bookingFee:    settings.bookingFee || "",
    tripMode:      settings.tripMode   || "holiday",
  };
}

module.exports = async (req, res) => {
  cleanExpiredBookings().catch(()=>{});
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  await connectDB();
  await seedIfNeeded();

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { action, id, num } = req.query;
  const busId = req.query.busId || req.body?.busId || "bus1";

  try {

    /* ════════════════════════════════
       GET OPERATIONS
    ════════════════════════════════ */

    if (req.method === "GET") {

      // List users — filtered by busId
      if (action === "users") {
        const users = await User.find({ busId }).select("-password").sort({ createdAt: -1 }).lean();
        return res.json(users.map(u => ({
          ...u,
          hasStudentID: !!u.studentID,
          studentID: u.studentID ? "has_file" : null
        })));
      }

      // List bookings — filtered by busId
      if (action === "bookings") {
        const bookings = await Booking.find({ busId }).sort({ createdAt: -1 }).lean();
        return res.json(bookings.map(b => ({
          ...b,
          hasPaymentProof: !!b.paymentProof
        })));
      }

      // Get seats — filtered by busId
      if (action === "seats") {
        const seats = await Seat.find({ busId }).sort({ number: 1 });
        return res.json(seats);
      }

      // Get settings
      if (action === "settings") {
        let s = await Settings.findOne();
        if (!s) s = await Settings.create({});
        return res.json(s);
      }

      // Get payment proof
      if (action === "proof" && id) {
        const b = await Booking.findById(id);
        if (!b || !b.paymentProof)
          return res.status(404).json({ success: false, message: "No payment proof found." });
        return res.json({ success: true, image: b.paymentProof, name: b.passengerName, passengerName: b.passengerName });
      }

      // Get receipt
      if (action === "receipt" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        const settings = await Settings.findOne();
        const bs = getBusSettings(settings, b.busId||"bus1");
        return res.json({
          success: true,
          receipt: {
            receiptNumber:  b.receiptNumber  || "",
            seatLabel:      b.seatLabel      || ("Seat "+b.seatNumber),
            passengerName:  b.passengerName  || "",
            phone:          b.phone          || "",
            program:        b.program        || "",
            destination:    b.destination    || "",
            origin:         b.origin         || "",
            busId:          b.busId          || "bus1",
            busName:        bs.busName,
            deposit:        b.deposit        || bs.bookingFee,
            departureDate:  b.departureDate  || bs.departureDate,
            departureVenue: b.departureVenue || bs.departureVenue,
            tripMode:       bs.tripMode,
            seatNumber:     b.seatNumber,
            status:         b.status,
            createdAt:      b.createdAt
          }
        });
      }

      // Get student ID
      if (action === "studentid" && id) {
        const user = await User.findById(id).select("studentID fullName");
        if (!user || !user.studentID)
          return res.status(404).json({ success: false, message: "No student ID found." });
        return res.json({ success: true, image: user.studentID, name: user.fullName });
      }

      return res.status(400).json({ success: false, message: "Unknown GET action: " + action });
    }

    /* ════════════════════════════════
       POST OPERATIONS
    ════════════════════════════════ */

    if (req.method === "POST") {

      // Approve booking
      if (action === "approve" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        b.status = "approved";
        if (!b.receiptNumber) {
          const {receiptNumber:rno, seatLabel:lbl} = await buildReceiptNumber(b.seatNumber, b.phone, Booking);
          b.receiptNumber = rno;
          b.seatLabel     = lbl;
        }
        if(!b.departureDate||!b.departureVenue||!b.deposit){
          const settings = await Settings.findOne();
          const bs = getBusSettings(settings, b.busId||"bus1");
          if(!b.departureDate)  b.departureDate  = bs.departureDate;
          if(!b.departureVenue) b.departureVenue = bs.departureVenue;
          if(!b.deposit)        b.deposit        = bs.bookingFee;
        }
        await b.save();
        await Seat.findOneAndUpdate({ number: b.seatNumber, busId: b.busId||"bus1" }, { status: "booked" });
        return res.json({ success: true });
      }

      // Reject booking
      if (action === "reject" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        b.status = "rejected";
        await b.save();
        await Seat.findOneAndUpdate({ number: b.seatNumber, busId: b.busId||"bus1" }, {
          status: "available", passengerName: null, destination: "", origin: ""
        });
        return res.json({ success: true });
      }

      // Delete booking
      if (action === "delete-booking" && id) {
        const b = await Booking.findById(id);
        if (b) {
          await Seat.findOneAndUpdate({ number: b.seatNumber, busId: b.busId||"bus1" }, {
            status: "available", passengerName: null, destination: "", origin: ""
          });
          await b.deleteOne();
        }
        return res.json({ success: true });
      }

      // Add booking manually
      if (action === "add-booking") {
        const { seatNumber, passengerName, destination, phone, tripMode } = req.body;
        if (!seatNumber || !passengerName)
          return res.json({ success: false, message: "Seat and name required." });
        const seat = await Seat.findOne({ number: Number(seatNumber), busId });
        if (!seat) return res.json({ success: false, message: "Seat not found." });

        const settings  = await Settings.findOne();
        const venue     = settings ? (settings[busId+"Venue"] || settings.departureVenue || "") : "";
        const isHoliday = (tripMode || "holiday") !== "backtoschool";
        // The modal has a single field whose meaning flips with trip mode —
        // same convention as book-seat.js: holiday = this field is the
        // destination (origin defaults to the common venue); back-to-school
        // = this field is the origin/hometown (destination defaults to venue).
        const originVal = isHoliday ? venue : (destination || "");
        const destVal    = isHoliday ? (destination || "") : venue;

        seat.status = "booked"; seat.passengerName = passengerName;
        seat.destination = destVal; seat.origin = originVal;
        await seat.save();
        await Booking.create({ busId, seatNumber: Number(seatNumber), passengerName, destination: destVal, origin: originVal, phone: phone||"", status: "approved" });
        const nameExists = await User.findOne({ fullName: { $regex: "^"+passengerName.trim()+"$", $options: "i" } });
        if (!nameExists) {
          await User.create({ busId, fullName: passengerName, phone: phone||("admin-"+Date.now()), program: "Admin Assigned", destination: destVal, origin: originVal });
        }
        return res.json({ success: true });
      }

      // Delete user
      if (action === "delete-user" && id) {
        await User.findByIdAndDelete(id);
        return res.json({ success: true });
      }

      // Add user manually
      if (action === "add-user") {
        const { fullName, phone, program, destination, origin } = req.body;
        if (!fullName || !phone) return res.json({ success: false, message: "Name and phone required." });
        if (await User.findOne({ phone })) return res.json({ success: false, message: "Phone already exists." });
        await User.create({ busId, fullName, phone, program: program||"Admin Assigned", destination: destination||"", origin: origin||"" });
        return res.json({ success: true });
      }

      // Edit seat directly
      if (action === "edit-seat" && num) {
        const { status, passengerName, destination, origin, phone, clearSeatNum } = req.body;
        const seatN = Number(num);
        const seat = await Seat.findOne({ number: seatN, busId });
        if (!seat) return res.status(404).json({ success: false });

        seat.status        = status || "available";
        seat.passengerName = status === "available" ? null : (passengerName || null);

        // Same trip-mode-aware resolution as book-seat.js / register.js / add-booking:
        // whichever of destination/origin the caller sent is treated as the single
        // "place" field the admin typed (the seat editor only ever sends `destination`,
        // saveEditBooking sends `origin` in back-to-school mode) — the other side is
        // filled in from the bus's common venue based on the currently active trip
        // mode. This keeps the seat grid, seat switch, and booking editor all
        // consistent instead of each writing raw fields straight to the DB.
        if (status === "available") {
          seat.destination = "";
          seat.origin      = "";
        } else if (destination !== undefined || origin !== undefined) {
          const settings  = await Settings.findOne();
          const venue     = settings ? (settings[busId+"Venue"] || settings.departureVenue || "") : "";
          const isHoliday = ((settings && settings.tripMode) || "holiday") !== "backtoschool";
          const place     = destination !== undefined ? destination : origin;
          seat.origin      = isHoliday ? venue : (place || "");
          seat.destination = isHoliday ? (place || "") : venue;
        }
        seat.phone         = phone || seat.phone || "";
        await seat.save();

        // If clearing seat, cancel its active booking
        if(!status || status === "available"){
          await Booking.findOneAndUpdate(
            { seatNumber: seatN, busId, status: { $ne: "rejected" } },
            { status: "rejected" }
          );
        }

        // If part of a seat switch — clear old seat by number
        if(clearSeatNum && Number(clearSeatNum) !== seatN){
          const oldSeatN = Number(clearSeatNum);
          await Seat.findOneAndUpdate(
            { number: oldSeatN, busId },
            { status: "available", passengerName: null, destination: "", origin: "", phone: "" }
          );
          await Booking.findOneAndUpdate(
            { seatNumber: oldSeatN, busId, status: { $ne: "rejected" } },
            { status: "rejected" }
          );
        }

        let bookingCreated = false;
        let bookingId      = null;

        if (status === "booked" && passengerName) {
          const nameExists = await User.findOne({ fullName: { $regex: "^"+passengerName.trim()+"$", $options: "i" } });
          if (!nameExists) {
            await User.create({ busId, fullName: passengerName.trim(), phone: phone||"", program: "Admin Assigned", destination: seat.destination||"", origin: seat.origin||"" });
          }
          const existing = await Booking.findOne({ seatNumber: seatN, busId, status: { $ne: "rejected" } });
          if (!existing) {
            const settings = await Settings.findOne();
            const bs = getBusSettings(settings, busId);
            const {receiptNumber:receiptNo, seatLabel:lbl} = await buildReceiptNumber(seatN, phone||"", Booking);
            const booking = await Booking.create({
              busId,
              seatNumber:    seatN,
              passengerName,
              destination:   seat.destination||"",
              origin:        seat.origin||"",
              phone:         phone||"",
              program:       "",
              receiptNumber: receiptNo,
              seatLabel:     lbl,
              deposit:       bs.bookingFee,
              departureDate: bs.departureDate,
              departureVenue:bs.departureVenue,
              paymentProof:  null,
              status:        "approved"
            });
            bookingCreated=true;
            bookingId=booking._id;
          } else if(existing.status==="pending"){
            existing.status="approved";
            if(!existing.receiptNumber){
              const {receiptNumber:receiptNo2, seatLabel:lbl2} = await buildReceiptNumber(seatN, existing.phone||phone||"", Booking);
              existing.receiptNumber = receiptNo2;
              if(!existing.seatLabel) existing.seatLabel = lbl2;
            }
            await existing.save();
            bookingId=existing._id;
          } else {
            bookingId=existing._id;
          }
        }

        // Also create pending booking record
        if (status === "pending" && passengerName) {
          const nameExists = await User.findOne({ fullName: { $regex: "^"+passengerName.trim()+"$", $options: "i" } });
          if (!nameExists) {
            await User.create({ busId, fullName: passengerName.trim(), phone: phone||"", program: "Admin Assigned", destination: seat.destination||"", origin: seat.origin||"" });
          }
          const existing = await Booking.findOne({ seatNumber: seatN, busId, status: { $ne: "rejected" } });
          if (!existing) {
            const settings = await Settings.findOne();
            const bs = getBusSettings(settings, busId);
            await Booking.create({
              busId,
              seatNumber:    seatN,
              passengerName,
              destination:   seat.destination||"",
              origin:        seat.origin||"",
              phone:         phone||"",
              program:       "",
              receiptNumber: "",
              seatLabel:     makeSeatLabel(seatN),
              deposit:       bs.bookingFee,
              departureDate: bs.departureDate,
              departureVenue:bs.departureVenue,
              paymentProof:  null,
              status:        "pending"
            });
            bookingCreated=true;
          } else {
            existing.passengerName = passengerName;
            existing.destination   = seat.destination||existing.destination;
            existing.origin        = seat.origin||existing.origin;
            await existing.save();
            bookingId=existing._id;
          }
        }

        return res.json({ success: true, bookingCreated, bookingId });
      }

      // Reset seats for a specific bus
      if (action === "reset-seats") {
        await Seat.updateMany({ busId }, { status: "available", passengerName: null, destination: "", origin: "", phone: "" });
        await Booking.deleteMany({ busId });
        return res.json({ success: true });
      }

      // Save settings
      if (action === "save-settings") {
        let s = await Settings.findOne();
        if (!s) s = new Settings();
        Object.assign(s, req.body);
        await s.save();
        return res.json({ success: true, settings: s });
      }

      // Change admin password
      if (action === "change-password") {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword || newPassword.length < 4)
          return res.json({ success: false, message: "Invalid password data." });
        const adminDoc = await Admin.findOne({ phone: admin.phone });
        if (!adminDoc) return res.json({ success: false, message: "Admin not found." });
        if (!await bcrypt.compare(currentPassword, adminDoc.password))
          return res.json({ success: false, message: "Current password is incorrect." });
        adminDoc.password = await bcrypt.hash(newPassword, 10);
        await adminDoc.save();
        return res.json({ success: true, message: "Password changed successfully." });
      }

      // Reset another admin to default password
      if (action === "reset-admin-password") {
        const { targetPhone } = req.body;
        if (!DEFAULT_PASSWORDS[targetPhone])
          return res.json({ success: false, message: "No default found for this admin." });
        const adminDoc = await Admin.findOne({ phone: targetPhone });
        if (!adminDoc) return res.json({ success: false, message: "Admin not found." });
        adminDoc.password = await bcrypt.hash(DEFAULT_PASSWORDS[targetPhone], 10);
        await adminDoc.save();
        return res.json({ success: true, message: `Password for ${adminDoc.fullName} reset to default.` });
      }

      // Update booking missing fields
      if (action === "update-booking" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        const {passengerName,phone,destination,origin,deposit,departureDate,departureVenue}=req.body||{};
        if(passengerName)  b.passengerName  = passengerName;
        if(phone)          b.phone          = phone;
        if(destination)    b.destination    = destination;
        if(origin)         b.origin         = origin;
        if(deposit)        b.deposit        = deposit;
        if(departureDate)  b.departureDate  = departureDate;
        if(departureVenue) b.departureVenue = departureVenue;
        if(!b.receiptNumber){
          const {receiptNumber,seatLabel} = await buildReceiptNumber(b.seatNumber, b.phone||"", Booking);
          b.receiptNumber = receiptNumber;
          b.seatLabel     = seatLabel;
        }
        if(!b.departureDate||!b.departureVenue||!b.deposit){
          const settings = await Settings.findOne();
          const bs = getBusSettings(settings, b.busId||"bus1");
          if(!b.departureDate)  b.departureDate  = bs.departureDate;
          if(!b.departureVenue) b.departureVenue = bs.departureVenue;
          if(!b.deposit)        b.deposit        = bs.bookingFee;
        }
        await b.save();
        return res.json({ success: true });
      }

      // Edit user credentials
      if (action === "edit-user" && id) {
        const { fullName, phone, program, destination, origin } = req.body;
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false });
        if(fullName)     user.fullName    = fullName;
        if(phone)        user.phone       = phone;
        if(program)      user.program     = program;
        if(destination !== undefined)  user.destination = destination;
        if(origin !== undefined)       user.origin      = origin;
        await user.save();
        return res.json({ success: true });
      }

      // Reset registration list for a specific bus
      if (action === "reset-users") {
        await User.deleteMany({ busId });
        return res.json({ success: true });
      }

      // Register passenger
      if (action === "register-passenger") {
        const { fullName, destination } = req.body;
        if (!fullName) return res.json({ success: false, message: "Name required." });
        const exists = await User.findOne({ fullName: { $regex: "^"+fullName.trim()+"$", $options: "i" } });
        if (exists) return res.json({ success: true, existing: true });
        await User.create({ busId, fullName: fullName.trim(), phone: "admin-"+Date.now(), program: "Admin Assigned", destination: destination||"" });
        return res.json({ success: true, existing: false });
      }

      return res.status(400).json({ success: false, message: "Unknown POST action: " + action });
    }

    res.status(405).end();

  } catch (err) {
    console.error("Admin error [" + action + "]:", err.message);
    res.status(500).json({ success: false, message: "Server error: " + err.message });
  }
};
