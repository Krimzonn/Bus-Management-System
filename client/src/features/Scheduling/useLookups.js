import { useEffect, useState } from "react";
import { listBuses, listDrivers, listRoutes } from "../../services/api.js";
import { fetchAll } from "./scheduleApi.js";
import { scheduleErrorMessage } from "./scheduleModel.js";

const EMPTY = { buses: [], drivers: [], routes: [] };

// Buses, drivers and routes (including archived, so history filters work) for the
// filter bar and the schedule form. Only users who may view all three can load
// them; everyone else gets empty lists and `enabled` stays false.
export default function useLookups(enabled) {
  const [reloadKey, setReloadKey] = useState(0);
  const [settled, setSettled] = useState({ key: -1, data: EMPTY, error: "" });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    Promise.all([
      fetchAll(listBuses, { archived: "all" }),
      fetchAll(listDrivers, { archived: "all" }),
      fetchAll(listRoutes, { archived: "all" }),
    ])
      .then(([buses, drivers, routes]) => {
        if (!cancelled) setSettled({ key: reloadKey, data: { buses, drivers, routes }, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setSettled({ key: reloadKey, data: EMPTY, error: scheduleErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  return {
    ...settled.data,
    enabled,
    loading: enabled && settled.key !== reloadKey,
    error: enabled ? settled.error : "",
    reload: () => setReloadKey((key) => key + 1),
  };
}
