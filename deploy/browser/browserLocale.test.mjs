import test from "node:test"
import assert from "node:assert/strict"
import { ACCEPT_LANGUAGE_ARG, ENGLISH_LOCALE, englishEnv } from "./browserLocale.mjs"

test("a session env in another language comes out English", () => {
  const env = englishEnv({ LANG: "tr_TR.UTF-8", LANGUAGE: "tr", PATH: "/usr/bin" })
  assert.equal(env.LANG, "en_US.UTF-8")
  assert.equal(env.LANGUAGE, "en_US:en")
  assert.equal(env.PATH, "/usr/bin") // everything that is not a language variable is untouched
})

// LC_MESSAGES outranks LANG, so pinning LANG alone would still leave a German browser.
test("LC_ALL is pinned too, so no inherited LC_MESSAGES can win", () => {
  const env = englishEnv({ LC_MESSAGES: "de_DE.UTF-8" })
  assert.equal(env.LC_ALL, "en_US.UTF-8")
})

test("the caller's own env object is never mutated", () => {
  const original = { LANG: "fr_FR.UTF-8" }
  englishEnv(original)
  assert.equal(original.LANG, "fr_FR.UTF-8")
})

test("the shared constant cannot be edited out from under a launcher", () => {
  assert.equal(Object.isFrozen(ENGLISH_LOCALE), true)
  assert.match(ACCEPT_LANGUAGE_ARG, /^--accept-lang=en-US,en$/)
})
