export function secureAccessConfigured() {
  return (process.env.COCKPIT_PASSWORD?.length ?? 0) >= 12 && ((process.env.COCKPIT_AUTH_SECRET || process.env.AUTH_SECRET)?.length ?? 0) >= 32;
}

export function requireSecureAccess() {
  if (!secureAccessConfigured()) throw new Error("Bitte vor Versand oder Buchung einen eigenen Cockpit-Zugang einrichten: Passwort mit mindestens 12 Zeichen und einen Signaturschlüssel mit mindestens 32 Zeichen.");
}
