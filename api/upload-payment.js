// api/upload-payment.js
// Returns Cloudinary signed upload credentials for direct browser upload
// The signature covers exactly the fields the browser will send

const { setHeaders } = require("./_auth");
const cloudinary = require("cloudinary").v2;

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const cloudName   = process.env.CLOUDINARY_CLOUD;
  const apiKey      = process.env.CLOUDINARY_KEY;
  const apiSecret   = process.env.CLOUDINARY_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error("Missing Cloudinary env vars");
    return res.json({ success: false, message: "Upload service not configured." });
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder    = "polycoach/payments";

    // Sign ONLY the fields we will send — no extras
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      apiSecret
    );

    res.json({
      success:   true,
      signature,
      timestamp,
      folder,
      cloudName,
      apiKey,
    });
  } catch (err) {
    console.error("Signature error:", err.message);
    res.json({ success: false, message: "Could not prepare upload." });
  }
};
