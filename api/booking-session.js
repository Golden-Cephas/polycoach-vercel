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
    // Both name AND phone must match the same record
    const user = await User.findOne({
      phone: phone.trim(),
      fullName: { $regex: "^" + name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" }
    });

    if (!user) {
      return res.json({ success: false, notFound: true });
    }

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
