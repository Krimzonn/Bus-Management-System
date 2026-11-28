// Public entry point of the Fuel module (AGENTS.md section 5.3).
// Reporting (Slice 13) reads fuel data only through these read-only functions.
export {
  getBusFuelHistory,
  getFuelRecord,
  getFuelSummary,
  listFuelRecords,
} from "./service.js";
export { estimateFuelEfficiency } from "./efficiency.js";