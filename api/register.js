const { connectDB, User } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();
  const { name, phone, program, destination } = req.body;
  if (!name || !phone || !program || !destination)
    return res.json({ success: false, message: "All fields are required." });
  try {
    const exists = await User.findOne({ phone });
    if (exists) {
      // Update details and return success — no duplicate
      exists.fullName    = name;
      exists.program     = program;
      exists.destination = destination;
      await exists.save();
      return res.json({ success: true, existing: true });
    }
    await User.create({ fullName: name, phone, program, destination });
    res.json({ success: true, existing: false });
  } catch (err) {
    console.error("Register error:", err.message);
    res.json({ success: false, message: "Registration failed. Please try again." });
  }
};
