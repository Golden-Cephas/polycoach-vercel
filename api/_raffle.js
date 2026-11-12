const mongoose = require("mongoose");
const { Schema } = mongoose;

const WinnerSchema = new Schema({
  entryId: { type: String, required: true },
  name:    { type: String, default: "" },
  detail:  { type: String, default: "" },
  wonAt:   { type: Date,   default: Date.now }
}, { _id: false });

const GiftSchema = new Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  photo:       { type: String, default: "" },
  winner:      { type: WinnerSchema, default: null }
});

const RaffleSchema = new Schema({
  eligibility: { type: String, enum: ["registered", "booked"], default: "registered" },
  busScope:    { type: String, enum: ["all", "bus1", "bus2"],  default: "all" },
  gifts:       { type: [GiftSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.models.Raffle || mongoose.model("Raffle", RaffleSchema);