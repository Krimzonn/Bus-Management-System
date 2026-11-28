// Public entry point of the Fleet module (AGENTS.md section 5.3).
// Other modules (for example Scheduling) import only from here.
export {
  evaluateBusEligibility,
  getBusAssignmentEligibility,
  getBusScheduleDefaults,
  getBusSummaries,
  lockBusForAssignment,
} from "./service.js";
