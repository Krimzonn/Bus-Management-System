import { useEffect, useState } from "react";
import { fetchAllBuses } from "./fuelApi.js";
import { fuelErrorMessage } from "./fuelModel.js";

// All buses (archived included, so history filters work) for the filter bar and
// the form. All three fuel roles can view buses.
export default function useFuelBuses(enabled) {
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
        if (!cancelled) setSettled({ key: reloadKey, buses: [], error: fuelErrorMessage(err) });
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