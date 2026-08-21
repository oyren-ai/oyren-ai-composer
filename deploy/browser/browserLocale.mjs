// The in-VM browser's language, pinned to English wherever the droplet sits and whatever locale the
// session carries.
//
// WHY it needs pinning: start-browser.mjs hands Chrome `mergedEnv()` — process.env plus the
// orchestrator's CONTAINER_ENV_B64 — and on Linux Chrome reads its UI language straight out of that
// locale chain (Chromium's own docs give `LANG=xx_YY.UTF-8 LANGUAGE=xx_YY chrome` as the way to run
// a non-English UI; `--lang` is the Windows lever and does nothing here). So anything that ever puts
// a LANG into the session env picks the browser's menus for the user, and nobody launching a
// sandbox asked to be handed a browser in the language of whichever region the droplet landed in.
//
// LC_ALL is set as well as LANG because it outranks every other LC_* — one variable that no
// inherited LC_MESSAGES can beat. install-browser.sh generates en_US.UTF-8 during the bake so glibc
// really has it; on an older snapshot that lacks it setlocale falls back to C, whose ICU default is
// en_US_POSIX — still English, which is the only property this has to guarantee.
export const ENGLISH_LOCALE = Object.freeze({
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  LANGUAGE: 'en_US:en',
})

/** `env` with the language variables pinned. Everything else passes through untouched. */
export function englishEnv(env) {
  return { ...env, ...ENGLISH_LOCALE }
}

// Accept-Language for every request the browser makes. Chrome derives this header from the UI
// locale when the pref is unset, so the env above would probably cover it — but this is the half
// that sites actually read, and one flag to state it outright beats depending on the derivation.
//
// It does NOT beat IP geolocation: google.com from a Frankfurt droplet still redirects to google.de
// in German, because that redirect is decided by the exit address, not by this header. The user-side
// answer to that one is https://www.google.com/ncr.
export const ACCEPT_LANGUAGE_ARG = '--accept-lang=en-US,en'
