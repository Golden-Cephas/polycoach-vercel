const { connectDB, seedIfNeeded, Admin, User } = require("./_db");
const { setHeaders, createToken } = require("./_auth");
const bcrypt = require("bcrypt");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();
  await seedIfNeeded();
  const { phone, password } = req.body;
  if (!phone || !password)
    return res.status(400).json({ success: false, message: "Phone and password required." });
  try {
    // Check admin first
    const admin = await Admin.findOne({ phone });
    if (admin && await bcrypt.compare(password, admin.password)) {
      const token = createToken({ fullName: admin.fullName, phone: admin.phone, role: "admin" });
      return res.json({
        success: true,
        token,
        user: { fullName: admin.fullName, phone: admin.phone, role: "admin" }
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid credentials."
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
