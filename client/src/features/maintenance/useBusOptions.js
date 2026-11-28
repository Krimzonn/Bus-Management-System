import { useEffect, useState } from "react";
import { fetchAllBuses } from "./maintenanceApi.js";
import { maintenanceErrorMessage } from "./maintenanceModel.js";

// All buses (archived included, so history filters work) for the filter bar and
// the form. Only users who may view buses can load them; all three maintenance
// roles can.
export default function useBusOptions(enabled) {
  const [reloadKey, setReloadKey] = useState(0);
  const [settled, setSettled] = useState({ key: -1, buses: [], error: "" });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetchAllBuses("all")
      .then((buses) => {
        if (!cancelled) setSettled({ key: reloadKey, buses, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setSettled({ key: reloadKey, buses: [], error: maintenanceErrorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  return {
    buses: settled.buses,
    loading: enabled && settled.key !== reloadKey,
    error: enabled ? settled.error : "",
    reload: () => setReloadKey((key) => key + 1),
  };
}