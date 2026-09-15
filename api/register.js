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

    const trimmedName  = String(name).trim();
    const trimmedPhone = String(phone).trim();

    // Only treat this as the same returning student when BOTH name and phone
    // match an existing registration exactly. A shared phone with a different
    // name (e.g. a sibling, a friend registering on someone's behalf) is
    // always a new entry — it must never overwrite someone else's record.
    const exists = await User.findOne({ phone: trimmedPhone, fullName: trimmedName });
    if (exists) {
      // Same person re-registering — update their record in place
      // (this is also the point where a bus/seat switch would apply,
      // since it's confirmed to be the same student).
      exists.busId       = busId;
      exists.origin      = resolvedOrigin;
      exists.destination = resolvedDestination;
      await exists.save();
      return res.json({ success: true, existing: true });
    }
    await User.create({
      fullName:    trimmedName,
      phone:       trimmedPhone,
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
