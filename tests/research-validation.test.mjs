import test from "node:test";
import assert from "node:assert/strict";
import {
  isCallReady,
  normalizeCallReadyPhone,
  normalizeVerifiedInstagram,
  scoreValidatedCandidate,
  validateBusinessEmail,
  validateResearchContacts,
} from "../lib/research-validation.ts";

test("German business phone validation rejects scraper IDs and keeps callable numbers", () => {
  assert.equal(normalizeCallReadyPhone("+49 (711) 1234567"), "+497111234567");
  assert.equal(normalizeCallReadyPhone("0711 1234567"), "+497111234567");
  assert.equal(normalizeCallReadyPhone("030 123456"), "+4930123456");
  assert.equal(normalizeCallReadyPhone("025062520250625"), "");
  assert.equal(normalizeCallReadyPhone("00011001980568"), "");
  assert.equal(normalizeCallReadyPhone("12345678"), "");
});

test("email validation distinguishes valid addresses from corporate domain matches", () => {
  assert.deepEqual(validateBusinessEmail("info@beispiel.de", "https://www.beispiel.de"), {
    valid: true,
    normalized: "info@beispiel.de",
    corporateMatch: true,
  });
  assert.deepEqual(validateBusinessEmail("team@gmail.com", "https://beispiel.de"), {
    valid: true,
    normalized: "team@gmail.com",
    corporateMatch: false,
  });
  assert.equal(validateBusinessEmail("noreply@example.com", "https://beispiel.de").valid, false);
});

test("Instagram validation accepts profiles but rejects posts and platform paths", () => {
  assert.equal(normalizeVerifiedInstagram("@beispiel"), "https://www.instagram.com/beispiel/");
  assert.equal(normalizeVerifiedInstagram("https://instagram.com/beispiel/"), "https://www.instagram.com/beispiel/");
  assert.equal(normalizeVerifiedInstagram("https://instagram.com/p/ABC123/"), "");
  assert.equal(normalizeVerifiedInstagram("https://instagram.com/beispiel/reel/ABC123/"), "");
});

test("call-ready requires a validated phone and a sufficient quality score", () => {
  const validation = validateResearchContacts({
    phone: "0711 1234567",
    email: "info@beispiel.de",
    instagramUrl: "https://instagram.com/beispiel/",
    websiteUrl: "https://beispiel.de",
    phoneSource: "google_places",
    emailSource: "website",
    instagramSource: "website",
  });
  const score = scoreValidatedCandidate({
    websiteUrl: "https://beispiel.de",
    source: "google_places",
    ratingX10: 45,
    reviewCount: 80,
    validation,
  });
  assert.equal(validation.phone.valid, true);
  assert.equal(validation.email.corporateMatch, true);
  assert.equal(validation.instagram.valid, true);
  assert.equal(isCallReady(validation, score), true);
  assert.equal(isCallReady({ ...validation, phone: { valid: false, normalized: "", source: "" } }, 100), false);
});
