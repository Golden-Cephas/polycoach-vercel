// api/upload-payment.js
// Generates a signed Cloudinary upload signature so the browser can
// upload the payment proof directly to Cloudinary without going through
// our server — faster, no size limits, no server memory issues

const { setHeaders } = require("./_auth");
const cloudinary = require("cloudinary").v2;

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD,
    api_key:    process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });

  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder    = "polycoach/payments";
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_SECRET
    );
    res.json({
      success:    true,
      signature,
      timestamp,
      folder,
      cloudName:  process.env.CLOUDINARY_CLOUD,
      apiKey:     process.env.CLOUDINARY_KEY,
    });
  } catch (err) {
    console.error("Upload signature error:", err.message);
    res.json({ success: false, message: "Could not prepare upload. Please try again." });
  }
};
