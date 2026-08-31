import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import chromium from "@sparticuz/chromium-min";
import puppeteer, { type Page } from "puppeteer-core";
import { instagramUsername, normalizeInstagramProfile } from "@/lib/social-profile";

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 980;
const MAX_CAPTURE_HEIGHT = 2600;
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isPrivateAddress(address: string): boolean {
  const value = normalizedHostname(address);
  const version = isIP(value);
  if (version === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    if (value === "::" || value === "::1") return true;
    if (/^(fc|fd)/.test(value) || /^fe[89ab]/.test(value)) return true;
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? isPrivateAddress(mapped) : false;
  }
  return false;
}

async function hostnameIsPublic(hostname: string) {
  const normalized = normalizedHostname(hostname);
  if (!normalized || normalized === "localhost" || normalized.endsWith(".local") || normalized.endsWith(".internal")) return false;
  if (isIP(normalized)) return !isPrivateAddress(normalized);
  const addresses = await lookup(normalized, { all: true, verbatim: true }).catch(() => []);
  return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
}


async function clickTextButton(page: Page, phrases: string[]) {
  return page.evaluate((candidatePhrases) => {
    const visible = (element: Element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 4 && rect.height > 4;
    };
    const controls = Array.from(document.querySelectorAll("button,[role='button'],a"));
    for (const element of controls) {
      const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text || text.length > 140 || !visible(element)) continue;
      const phrase = candidatePhrases.find((candidate) => text === candidate || text.includes(candidate));
      if (!phrase || !(element instanceof HTMLElement)) continue;
      element.click();
      return phrase;
    }
    return null;
  }, phrases);
}

async function cleanInstagramUi(page: Page) {
  let actions = 0;
  const consentPhrases = [
    "nur erforderliche cookies erlauben",
    "optionale cookies ablehnen",
    "alle cookies ablehnen",
    "allow essential cookies",
    "decline optional cookies",
    "reject all",
  ];
  for (let pass = 0; pass < 3; pass += 1) {
    const action = await clickTextButton(page, consentPhrases).catch(() => null);
    if (action) actions += 1;
    await sleep(action ? 650 : 300);
  }

  const hiddenOverlays = await page.evaluate(() => {
    let hidden = 0;
    const hide = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return;
      element.style.setProperty("display", "none", "important");
      hidden += 1;
    };

    for (const dialog of Array.from(document.querySelectorAll("[role='dialog'],[aria-modal='true']"))) {
      const text = (dialog.textContent || "").toLowerCase();
      if (/(anmelden|registrieren|log in|sign up|instagram verwenden|continue on instagram)/i.test(text)) {
        hide(dialog);
        const parent = dialog.parentElement;
        if (parent && getComputedStyle(parent).position === "fixed") hide(parent);
      }
    }
    for (const element of Array.from(document.querySelectorAll("body > div"))) {
      if (!(element instanceof HTMLElement)) continue;
      const style = getComputedStyle(element);
      const text = (element.textContent || "").slice(0, 1000).toLowerCase();
      if (style.position === "fixed" && /(anmelden|registrieren|log in|sign up)/i.test(text) && element.getBoundingClientRect().height > innerHeight * 0.5) {
        hide(element);
      }
    }
    document.documentElement.style.setProperty("overflow", "auto", "important");
    document.body?.style.setProperty("overflow", "auto", "important");
    return hidden;
  }).catch(() => 0);

  return { actions, hiddenOverlays };
}

export type SocialProfileCaptureResult = {
  buffer: Buffer;
  height: number;
  consentClicks: number;
  hiddenOverlays: number;
  username: string;
};

export async function captureInstagramProfile(input: string): Promise<SocialProfileCaptureResult> {
  const profileUrl = normalizeInstagramProfile(input);
  const username = instagramUsername(profileUrl);
  if (!(await hostnameIsPublic("www.instagram.com"))) {
    throw new Error("Instagram konnte aus der Serverumgebung nicht erreicht werden.");
  }

  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(
    process.env.CHROMIUM_PACK_URL || CHROMIUM_PACK_URL,
  );
  const args = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
  const browser = await puppeteer.launch({
    args,
    executablePath,
    headless: "shell",
    defaultViewport: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false,
    },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "accept-language": "de-DE,de;q=0.9,en;q=0.7" });
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      try {
        const requestUrl = new URL(request.url());
        if (!["http:", "https:", "data:", "blob:"].includes(requestUrl.protocol)) {
          await request.abort("blockedbyclient");
          return;
        }
        if (["http:", "https:"].includes(requestUrl.protocol) && !(await hostnameIsPublic(requestUrl.hostname))) {
          await request.abort("blockedbyclient");
          return;
        }
        if (["media", "font"].includes(request.resourceType())) {
          await request.abort("blockedbyclient");
          return;
        }
        await request.continue();
      } catch {
        await request.abort("blockedbyclient").catch(() => undefined);
      }
    });

    const response = await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) {
      throw new Error(`Instagram antwortet mit HTTP ${response?.status() || "unbekannt"}.`);
    }
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 10_000 }).catch(() => undefined);
    await sleep(1300);
    const cleanup = await cleanInstagramUi(page);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(500);

    const state = await page.evaluate((expectedUsername) => {
      const bodyText = (document.body?.innerText || "").toLowerCase();
      const hasProfileHeader = Boolean(document.querySelector("header"));
      const hasUsername = bodyText.includes(expectedUsername.toLowerCase());
      const loginOnly = /log in|anmelden/.test(bodyText) && /sign up|registrieren/.test(bodyText) && !hasUsername;
      return { hasProfileHeader, hasUsername, loginOnly, title: document.title };
    }, username);
    if (state.loginOnly || (!state.hasProfileHeader && !state.hasUsername)) {
      throw new Error("Instagram zeigt aktuell nur die Login-Seite. Hinterlege für diesen Lead stattdessen einen Profil-Screenshot im Cockpit.");
    }

    const height = await page.evaluate((maximumHeight) => Math.min(
      maximumHeight,
      Math.max(980, document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0),
    ), MAX_CAPTURE_HEIGHT);
    const screenshot = await page.screenshot({
      type: "webp",
      quality: 88,
      clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height },
      captureBeyondViewport: true,
      optimizeForSpeed: true,
    });

    return {
      buffer: Buffer.from(screenshot),
      height,
      consentClicks: cleanup.actions,
      hiddenOverlays: cleanup.hiddenOverlays,
      username,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
