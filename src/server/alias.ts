// A stable display handle derived from a playerId, so the live feed and
// leaderboards can show "GoldenFox42" instead of a raw id, without accounts or
// storing any personal data. Deterministic: same id always maps to same handle.
const ADJ = [
  "Lucky", "Sly", "Bold", "Wild", "Swift", "Golden", "Silent", "Royal",
  "Cosmic", "Fierce", "Mystic", "Turbo", "Neon", "Shadow", "Crimson", "Frost",
];
const NOUN = [
  "Fox", "Wolf", "Tiger", "Eagle", "Shark", "Falcon", "Panther", "Dragon",
  "Cobra", "Lynx", "Raven", "Bison", "Otter", "Hawk", "Viper", "Puma",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function alias(playerId: string): string {
  const h = hash(playerId);
  return `${ADJ[h % ADJ.length]}${NOUN[(h >>> 8) % NOUN.length]}${((h >>> 16) % 90) + 10}`;
}
