// api/booking-session.js — Lookup student by name + phone against registration list
// POST /api/booking-session

const { connectDB, User } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();

  const { name, phone } = req.body;
  if (!name || !phone)
    return res.json({ success: false, message: "Name and phone are required." });

  try {
    // Search across both buses — match by phone first (exact), then fall back to name match
    let user = await User.findOne({ phone: phone.trim() });

    if (!user) {
      // Try case-insensitive name match as fallback
      user = await User.findOne({
        fullName: { $regex: "^" + name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" }
      });
    }

    if (!user) {
      return res.json({ success: false, notFound: true });
    }

    // Return the student's full registration record
    return res.json({
      success: true,
      user: {
        name:        user.fullName,
        phone:       user.phone,
        busId:       user.busId       || "bus1",
        origin:      user.origin      || "",
        destination: user.destination || "",
        program:     user.program     || ""
      }
    });

  } catch (err) {
    console.error("booking-session error:", err.message);
    return res.json({ success: false, message: "Server error. Please try again." });
  }
};
