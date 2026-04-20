const { connectDB, User } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();
  const { fullName, phone, program, destination } = req.body;
  if (!fullName || !phone || !program || !destination)
    return res.json({ success: false, message: "Please fill in all fields." });
  try {
    const exists = await User.findOne({ phone });
    if (exists) {
      exists.fullName = fullName; exists.program = program; exists.destination = destination;
      await exists.save();
    } else {
      await User.create({ fullName, phone, program, destination });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("booking-session error:", err.message);
    res.json({ success: false, message: "Could not save your details. Please try again." });
  }
};
