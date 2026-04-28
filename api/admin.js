// api/admin.js — ALL admin operations in one serverless function
// Route via ?action= query parameter
// Examples:
//   GET  /api/admin?action=users
//   GET  /api/admin?action=bookings
//   GET  /api/admin?action=seats
//   GET  /api/admin?action=settings
//   POST /api/admin?action=approve&id=xxx
//   POST /api/admin?action=reject&id=xxx
//   POST /api/admin?action=delete-booking&id=xxx
//   POST /api/admin?action=add-booking
//   POST /api/admin?action=delete-user&id=xxx
//   POST /api/admin?action=add-user
//   POST /api/admin?action=edit-seat&num=xx
//   POST /api/admin?action=reset-seats
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
// X = seat label, Y = DDMMYY + last6 digits of phone, Z = daily index
async function buildReceiptNumber(seatNum, phone, Booking){
  const lbl = makeSeatLabel(seatNum);
  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2,"0");
  const mm   = String(now.getMonth()+1).padStart(2,"0");
  const yy   = String(now.getFullYear()).slice(-2);
  // Extract only digits from phone, take last 6, pad if short
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

// Auto-delete bookings 48h after their departure date to save space
async function cleanExpiredBookings() {
  try {
    const bookings = await Booking.find({ departureDate: { $ne: "" } }).lean();
    for (const b of bookings) {
      if (!b.departureDate) continue;
      // Parse departure date — handles "15 May 2026" format
      const dep = new Date(b.departureDate);
      if (isNaN(dep.getTime())) continue;
      const expiry = new Date(dep.getTime() + 48 * 60 * 60 * 1000);
      if (new Date() > expiry) {
        await Booking.findByIdAndDelete(b._id);
        // Release the seat
        await Seat.findOneAndUpdate(
          { number: b.seatNumber },
          { status: "available", passengerName: null, destination: "", phone: "" }
        );
      }
    }
  } catch(e) { console.error("Cleanup error:", e.message); }
}

module.exports = async (req, res) => {
  // Run cleanup on every admin request — lightweight, runs async
  cleanExpiredBookings().catch(()=>{});
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  await connectDB();
  await seedIfNeeded();

  // All admin routes require valid JWT
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { action, id, num } = req.query;

  try {

    /* ════════════════════════════════
       GET OPERATIONS
    ════════════════════════════════ */

    if (req.method === "GET") {

      // List all users
      if (action === "users") {
        const users = await User.find().select("-password").sort({ createdAt: -1 }).lean();
        return res.json(users.map(u => ({
          ...u,
          hasStudentID: !!u.studentID,
          studentID: u.studentID ? "has_file" : null
        })));
      }

      // List all bookings
      if (action === "bookings") {
        const bookings = await Booking.find().sort({ createdAt: -1 }).lean();
        return res.json(bookings.map(b => ({
          ...b,
          hasPaymentProof: !!b.paymentProof
        })));
      }

      // Get all seats
      if (action === "seats") {
        const seats = await Seat.find().sort({ number: 1 });
        return res.json(seats);
      }

      // Get settings
      if (action === "settings") {
        let s = await Settings.findOne();
        if (!s) s = await Settings.create({});
        return res.json(s);
      }

      // Get payment proof for a booking
      if (action === "proof" && id) {
        const b = await Booking.findById(id);
        if (!b || !b.paymentProof)
          return res.status(404).json({ success: false, message: "No payment proof found." });
        return res.json({ success: true, image: b.paymentProof, name: b.passengerName });
      }

      // Get receipt for a booking
      if (action === "receipt" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        const settings = await Settings.findOne();
        return res.json({
          success: true,
          receipt: {
            receiptNumber:  b.receiptNumber  || "",
            seatLabel:      b.seatLabel      || ("Seat "+b.seatNumber),
            passengerName:  b.passengerName  || "",
            phone:          b.phone          || "",
            program:        b.program        || "",
            destination:    b.destination    || "",
            deposit:        b.deposit        || (settings&&settings.bookingFee)     || "",
            departureDate:  b.departureDate  || (settings&&settings.departureDate)  || "",
            departureVenue: b.departureVenue || (settings&&settings.departureVenue) || "",
            seatNumber:     b.seatNumber,
            status:         b.status,
            createdAt:      b.createdAt
          }
        });
      }

      // Get student ID for a user
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
        // Generate receipt number if not set
        if (!b.receiptNumber) {
          const n=b.seatNumber;
          const {receiptNumber:rno, seatLabel:lbl} = await buildReceiptNumber(b.seatNumber, b.phone, Booking);
          b.receiptNumber = rno;
          b.seatLabel     = lbl;
        }
        // Pull departure info from settings if missing
        if(!b.departureDate||!b.departureVenue||!b.deposit){
          const settings=await Settings.findOne();
          if(settings){
            if(!b.departureDate)  b.departureDate  = settings.departureDate  ||"";
            if(!b.departureVenue) b.departureVenue = settings.departureVenue ||"";
            if(!b.deposit)        b.deposit        = settings.bookingFee     ||"";
          }
        }
        await b.save();
        await Seat.findOneAndUpdate({ number: b.seatNumber }, { status: "booked" });
        return res.json({ success: true });
      }

      // Reject booking
      if (action === "reject" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        b.status = "rejected";
        await b.save();
        await Seat.findOneAndUpdate({ number: b.seatNumber }, {
          status: "available", passengerName: null, destination: ""
        });
        return res.json({ success: true });
      }

      // Delete booking
      if (action === "delete-booking" && id) {
        const b = await Booking.findById(id);
        if (b) {
          await Seat.findOneAndUpdate({ number: b.seatNumber }, {
            status: "available", passengerName: null, destination: ""
          });
          await b.deleteOne();
        }
        return res.json({ success: true });
      }

      // Add booking manually
      if (action === "add-booking") {
        const { seatNumber, passengerName, destination, phone } = req.body;
        if (!seatNumber || !passengerName)
          return res.json({ success: false, message: "Seat and name required." });
        const seat = await Seat.findOne({ number: Number(seatNumber) });
        if (!seat) return res.json({ success: false, message: "Seat not found." });
        seat.status = "booked"; seat.passengerName = passengerName; seat.destination = destination || "";
        await seat.save();
        await Booking.create({ seatNumber: Number(seatNumber), passengerName, destination: destination||"", phone: phone||"", status: "approved" });
        // Auto-register passenger
        const nameExists = await User.findOne({ fullName: { $regex: "^"+passengerName.trim()+"$", $options: "i" } });
        if (!nameExists) {
          await User.create({ fullName: passengerName, phone: phone||("admin-"+Date.now()), program: "Admin Assigned", destination: destination||"" });
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
        const { fullName, phone, program, destination } = req.body;
        if (!fullName || !phone) return res.json({ success: false, message: "Name and phone required." });
        if (await User.findOne({ phone })) return res.json({ success: false, message: "Phone already exists." });
        await User.create({ fullName, phone, program: program||"Admin Assigned", destination: destination||"" });
        return res.json({ success: true });
      }

      // Edit seat directly
      if (action === "edit-seat" && num) {
        const { status, passengerName, destination, phone } = req.body;
        const seatN = Number(num);
        const seat = await Seat.findOne({ number: seatN });
        if (!seat) return res.status(404).json({ success: false });
        seat.status        = status || "available";
        seat.passengerName = status === "available" ? null : (passengerName || null);
        seat.destination   = destination || "";
        seat.phone         = phone || seat.phone || "";
        await seat.save();

        let bookingCreated = false;
        let bookingId      = null;

        if (status === "booked" && passengerName) {
          // Auto-register passenger
          const nameExists = await User.findOne({ fullName: { $regex: "^"+passengerName.trim()+"$", $options: "i" } });
          if (!nameExists) {
            await User.create({ fullName: passengerName.trim(), phone: phone||("admin-"+Date.now()), program: "Admin Assigned", destination: destination||"" });
          }
          // Create booking record if none exists for this seat
          const existing = await Booking.findOne({ seatNumber: seatN, status: { $ne: "rejected" } });
          if (!existing) {
            const settings = await Settings.findOne();
            // Build receipt number X-Y-Z
            const {receiptNumber:receiptNo, seatLabel:lbl} = await buildReceiptNumber(seatN, phone, Booking);
            const booking = await Booking.create({
              seatNumber:    seatN,
              passengerName,
              destination:   destination||"",
              phone:         phone||"",
              program:       "",
              receiptNumber: receiptNo,
              seatLabel:     lbl,
              deposit:       (settings&&settings.bookingFee)     ||"",
              departureDate: (settings&&settings.departureDate)  ||"",
              departureVenue:(settings&&settings.departureVenue) ||"",
              paymentProof:  null,
              status:        "approved"
            });
            bookingCreated=true;
            bookingId=booking._id;
          } else if(existing.status==="pending"){
            existing.status="approved";
            if(!existing.receiptNumber) existing.receiptNumber="SEAT"+seatN+"-APPROVED";
            await existing.save();
            bookingId=existing._id;
          } else {
            bookingId=existing._id;
          }
        }
        return res.json({ success: true, bookingCreated, bookingId });
      }

      // Reset all seats
      if (action === "reset-seats") {
        await Seat.updateMany({}, { status: "available", passengerName: null, destination: "", phone: "" });
        await Booking.deleteMany({});
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

      // Update booking missing fields from popup
      if (action === "update-booking" && id) {
        const b = await Booking.findById(id);
        if (!b) return res.status(404).json({ success: false });
        const {passengerName,phone,destination,deposit,departureDate,departureVenue}=req.body||{};
        if(passengerName)  b.passengerName  = passengerName;
        if(phone)          b.phone          = phone;
        if(destination)    b.destination    = destination;
        if(deposit)        b.deposit        = deposit;
        if(departureDate)  b.departureDate  = departureDate;
        if(departureVenue) b.departureVenue = departureVenue;
        // Generate receipt number now if still missing
        if(!b.receiptNumber){
          const {receiptNumber,seatLabel} = await buildReceiptNumber(b.seatNumber, b.phone, Booking);
          b.receiptNumber = receiptNumber;
          b.seatLabel     = seatLabel;
        }
        // Pull departure info from settings if still missing
        if(!b.departureDate||!b.departureVenue||!b.deposit){
          const settings = await Settings.findOne();
          if(settings){
            if(!b.departureDate)  b.departureDate  = settings.departureDate  ||"";
            if(!b.departureVenue) b.departureVenue = settings.departureVenue ||"";
            if(!b.deposit)        b.deposit        = settings.bookingFee     ||"";
          }
        }
        await b.save();
        return res.json({ success: true });
      }

      // Register passenger (from seat edit)
      if (action === "register-passenger") {
        const { fullName, destination } = req.body;
        if (!fullName) return res.json({ success: false, message: "Name required." });
        const exists = await User.findOne({ fullName: { $regex: "^"+fullName.trim()+"$", $options: "i" } });
        if (exists) return res.json({ success: true, existing: true });
        await User.create({ fullName: fullName.trim(), phone: "admin-"+Date.now(), program: "Admin Assigned", destination: destination||"" });
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
