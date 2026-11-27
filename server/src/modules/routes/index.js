// Public entry point of the Routes module (AGENTS.md section 5.3).
// Other modules (for example Scheduling) import only from here.
export {
  evaluateRouteEligibility,
  getRouteAssignmentEligibility,
  listSelectableRoutes,
} from "./service.js";