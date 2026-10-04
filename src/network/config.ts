/**
 * Where the app sends reports and gets chests from. Two ways to connect, chosen at build time:
 *
 *  - direct: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY. The app talks to Supabase with the PUBLISHABLE
 *    key. Reports are checked later by the review job. Never put a secret / service-role key here: everything in
 *    EXPO_PUBLIC_* is readable by anyone who opens the app.
 *  - server: EXPO_PUBLIC_VERIFIER_URL, the address of the verifier service, which checks reports at once.
 *
 * With neither set, the app works fully offline.
 */
export const SUPABASE_URL: string = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_KEY: string = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
export const VERIFIER_URL: string = (process.env.EXPO_PUBLIC_VERIFIER_URL ?? '').replace(/\/+$/, '');

export type BackendMode = 'direct' | 'server' | 'none';

export const backendMode: BackendMode = SUPABASE_URL && SUPABASE_KEY ? 'direct' : VERIFIER_URL ? 'server' : 'none';

/** True when there is anywhere to send reports. Kept under its older name because screens already use it. */
export const verifierConfigured = backendMode !== 'none';
export const directMode = backendMode === 'direct';
