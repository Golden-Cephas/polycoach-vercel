const { connectDB, User, Settings } = require("./_db");
const { setHeaders } = require("./_auth");

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  await connectDB();

  const { name, phone, busId, origin, destination } = req.body;
  if (!name || !phone || !busId)
    return res.json({ success: false, message: "Name, phone and bus are required." });

  try {
    const settings = await Settings.findOne();
    const mode     = (settings && settings.tripMode) || "holiday";
    const isHoliday = mode !== "backtoschool";

    // In holiday mode: departureVenue is common (From), student provides destination (To)
    // In back-to-school: common destination (To), student provides origin (From)
    const resolvedOrigin      = isHoliday
      ? (settings && (settings[busId+"Venue"] || settings.departureVenue) || "")
      : (origin || "");
    const resolvedDestination = isHoliday
      ? (destination || "")
      : (settings && (settings[busId+"Venue"] || settings.departureVenue) || "");

    const exists = await User.findOne({ phone });
    if (exists) {
      exists.fullName    = name;
      exists.busId       = busId;
      exists.origin      = resolvedOrigin;
      exists.destination = resolvedDestination;
      await exists.save();
      return res.json({ success: true, existing: true });
    }
    await User.create({
      fullName:    name,
      phone,
      busId,
      origin:      resolvedOrigin,
      destination: resolvedDestination,
      program:     "Online Registration"
    });
    res.json({ success: true, existing: false });
  } catch (err) {
    console.error("Register error:", err.message);
    res.json({ success: false, message: "Registration failed. Please try again." });
  }
};
