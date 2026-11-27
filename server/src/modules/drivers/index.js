// Public entry point of the Drivers module (AGENTS.md section 5.3).
// Other modules (for example Scheduling) import only from here.
export {
  evaluateDriverEligibility,
  getDriverAssignmentEligibility,
} from "./service.js";
