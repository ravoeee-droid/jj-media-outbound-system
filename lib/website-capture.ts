import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import chromium from "@sparticuz/chromium-min";
import puppeteer, { type Frame, type Page } from "puppeteer-core";

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const MAX_CAPTURE_HEIGHT = 16_000;
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

const rejectSelectors = [
  "#onetrust-reject-all-handler",
  "#CybotCookiebotDialogBodyButtonDecline",
  "[data-testid='uc-deny-all-button']",
  "[data-testid='uc-reject-all-button']",
  ".cmplz-deny",
  "[data-cookie-consent='reject']",
  "[data-consent-action='reject']",
  "[data-cookie-action='reject']",
];

const acceptSelectors = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "[data-testid='uc-accept-all-button']",
  ".cmplz-accept",
  "[data-cookie-consent='accept']",
  "[data-consent-action='accept']",
  "[data-cookie-action='accept']",
  "[data-borlabs-cookie-accept-all]",
  "[data-cookie-accept-all]",
];

const rejectPhrases = [
  "nur notwendige",
  "nur erforderliche",
  "alle ablehnen",
  "alles ablehnen",
  "ablehnen",
  "notwendige cookies",
  "reject all",
  "decline all",
  "only necessary",
  "necessary only",
  "essentials only",
  "continue without accepting",
];

const acceptPhrases = [
  "alle akzeptieren",
  "alles akzeptieren",
  "akzeptieren",
  "zustimmen",
  "einverstanden",
  "accept all",
  "allow all",
  "agree",
  "got it",
];

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

function isBlockedHostname(hostname: string) {
  const value = normalizedHostname(hostname);
  return (
    !value ||
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal") ||
    value === "metadata.google.internal" ||
    isPrivateAddress(value)
  );
}

const hostnameSafety = new Map<string, Promise<boolean>>();

async function hostnameIsPublic(hostname: string) {
  const normalized = normalizedHostname(hostname);
  if (isBlockedHostname(normalized)) return false;
  if (isIP(normalized)) return !isPrivateAddress(normalized);

  const cached = hostnameSafety.get(normalized);
  if (cached) return cached;
  const result = lookup(normalized, { all: true, verbatim: true })
    .then((addresses) => addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address)))
    .catch(() => false);
  hostnameSafety.set(normalized, result);
  return result;
}

async function assertSafeUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Die Website-Adresse ist ungültig.");
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Es sind nur öffentliche HTTP- und HTTPS-Websites erlaubt.");
  }
  if (!(await hostnameIsPublic(url.hostname))) {
    throw new Error("Private oder lokale Netzwerkadressen dürfen nicht aufgenommen werden.");
  }
  return url.toString();
}

async function clickConsentInFrame(frame: Frame, selectors: string[], phrases: string[]) {
  return frame.evaluate(
    ({ candidateSelectors, candidatePhrases }) => {
      const roots: Array<Document | ShadowRoot> = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of Array.from(roots[index].querySelectorAll("*"))) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }

      const visible = (element: Element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
      };
      const click = (element: Element, label: string) => {
        if (!(element instanceof HTMLElement) || !visible(element)) return null;
        element.click();
        return label;
      };

      for (const root of roots) {
        for (const selector of candidateSelectors) {
          const element = root.querySelector(selector);
          const clicked = element ? click(element, selector) : null;
          if (clicked) return clicked;
        }
      }

      for (const root of roots) {
        const controls = root.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a");
        for (const element of Array.from(controls)) {
          if (!visible(element)) continue;
          const raw = element instanceof HTMLInputElement ? element.value : element.textContent;
          const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (!text || text.length > 100) continue;
          const phrase = candidatePhrases.find((candidate) => text === candidate || text.includes(candidate));
          const clicked = phrase ? click(element, `text:${phrase}`) : null;
          if (clicked) return clicked;
        }
      }
      return null;
    },
    { candidateSelectors: selectors, candidatePhrases: phrases },
  );
}

async function hideConsentOverlays(frame: Frame) {
  return frame.evaluate(() => {
    const roots: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of Array.from(roots[index].querySelectorAll("*"))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }

    const hidden = new Set<HTMLElement>();
    const hide = (element: Element | null) => {
      if (!(element instanceof HTMLElement) || hidden.has(element)) return;
      element.style.setProperty("display", "none", "important");
      element.setAttribute("data-dg-cookie-hidden", "true");
      hidden.add(element);
    };
    const knownSelectors = [
      "#onetrust-banner-sdk",
      "#onetrust-consent-sdk",
      "#CybotCookiebotDialog",
      "#CybotCookiebotDialogBodyUnderlay",
      "#usercentrics-root",
      ".cmplz-cookiebanner",
      "[id*='cookie-banner' i]",
      "[class*='cookie-banner' i]",
      "[class*='cookiebanner' i]",
      "[id*='consent-banner' i]",
      "[class*='consent-banner' i]",
    ];
    for (const root of roots) {
      for (const selector of knownSelectors) {
        for (const element of Array.from(root.querySelectorAll(selector))) hide(element);
      }
      const candidates = root.querySelectorAll("[role='dialog'], [aria-modal='true'], aside, section, div");
      for (const element of Array.from(candidates).slice(0, 5000)) {
        if (!(element instanceof HTMLElement)) continue;
        const style = getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") continue;
        const rect = element.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const viewportArea = Math.max(1, innerWidth * innerHeight);
        if (area < viewportArea * 0.08) continue;
        const text = (element.textContent || "").slice(0, 2500);
        const signature = `${element.id} ${element.className} ${text}`;
        if (/(cookie|consent|datenschutz|einwilligung|privacy|tracking|cmp)/i.test(signature)) hide(element);
      }
    }

    document.documentElement.style.setProperty("overflow", "auto", "important");
    document.body?.style.setProperty("overflow", "auto", "important");
    document.documentElement.style.removeProperty("padding-right");
    document.body?.style.removeProperty("padding-right");
    return hidden.size;
  });
}

async function cleanCookieConsent(page: Page) {
  const actions: string[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    let clickedThisPass = false;
    for (const frame of page.frames()) {
      try {
        const rejected = await clickConsentInFrame(frame, rejectSelectors, rejectPhrases);
        const action = rejected || (await clickConsentInFrame(frame, acceptSelectors, acceptPhrases));
        if (action) {
          actions.push(action);
          clickedThisPass = true;
        }
      } catch {
        // Cross-origin or detached frames are ignored; the DOM fallback runs afterwards.
      }
    }
    await sleep(clickedThisPass ? 700 : 450);
  }

  let hiddenOverlays = 0;
  for (const frame of page.frames()) {
    try {
      hiddenOverlays += await hideConsentOverlays(frame);
    } catch {
      // Detached frames are harmless at capture time.
    }
  }
  return { actions, hiddenOverlays };
}

async function primeLazyContent(page: Page) {
  await page.evaluate(async (maximumHeight) => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const height = Math.min(
      maximumHeight,
      Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0),
    );
    for (let top = 0; top < height; top += 650) {
      window.scrollTo({ top, behavior: "instant" });
      await wait(85);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, MAX_CAPTURE_HEIGHT);
  await sleep(450);
}

export type WebsiteCaptureResult = {
  buffer: Buffer;
  height: number;
  cookieClicks: number;
  hiddenOverlays: number;
};

export async function captureExternalWebsite(inputUrl: string): Promise<WebsiteCaptureResult> {
  const websiteUrl = await assertSafeUrl(inputUrl);
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
        await request.continue();
      } catch {
        await request.abort("blockedbyclient").catch(() => undefined);
      }
    });

    const response = await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: 40_000 });
    if (!response || response.status() >= 400) {
      throw new Error(`Die Website antwortet mit HTTP ${response?.status() || "unbekannt"}.`);
    }
    await assertSafeUrl(page.url());
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 8_000 }).catch(() => undefined);
    await sleep(900);

    const firstCleanup = await cleanCookieConsent(page);
    await primeLazyContent(page);
    const secondCleanup = await cleanCookieConsent(page);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(350);

    const height = await page.evaluate((maximumHeight) => Math.min(
      maximumHeight,
      Math.max(720, document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0),
    ), MAX_CAPTURE_HEIGHT);
    const screenshot = await page.screenshot({
      type: "webp",
      quality: 84,
      clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height },
      captureBeyondViewport: true,
      optimizeForSpeed: true,
    });

    return {
      buffer: Buffer.from(screenshot),
      height,
      cookieClicks: firstCleanup.actions.length + secondCleanup.actions.length,
      hiddenOverlays: firstCleanup.hiddenOverlays + secondCleanup.hiddenOverlays,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
