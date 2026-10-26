// localStorage can throw or be empty (private mode, blocked storage); the game must run without it.

export function loadJSON<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    // Fall through to defaults.
  }
  return { ...fallback };
}

export function saveJSON(key: string, value: object) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted; nothing else to do.
  }
}
