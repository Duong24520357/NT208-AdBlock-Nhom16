import { useCallback, useEffect, useState } from "react";

function loadValue(key, fallback) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) return resolve(fallback);
    chrome.storage.local.get([key], (data) => {
      resolve(data?.[key] ?? fallback);
    });
  });
}

export function useChromeStorage(key, fallback) {
  const [value, setValue] = useState(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadValue(key, fallback).then((stored) => {
      if (!active) return;
      setValue(stored);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [key, fallback]);

  const save = useCallback(
    (nextValue) => {
      setValue(nextValue);
      chrome.storage.local.set({ [key]: nextValue });
    },
    [key],
  );

  return [value, save, ready];
}
