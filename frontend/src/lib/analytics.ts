/**
 * Lightweight analytics abstraction.
 *
 * Drop-in ready for PostHog, Mixpanel, or any provider.
 * Currently logs to console in development; no-ops in production.
 *
 * To connect PostHog:
 *   1. npm install posthog-js
 *   2. Initialize in providers.tsx: posthog.init(key, { api_host })
 *   3. Replace the functions below with posthog.capture / posthog.identify
 */

const isDev = typeof window !== "undefined" && window.location.hostname === "localhost";

export function trackEvent(name: string, properties?: Record<string, unknown>) {
  if (isDev) {
    console.debug("[Analytics]", name, properties);
  }
  // PostHog: posthog.capture(name, properties);
  // Mixpanel: mixpanel.track(name, properties);
}

export function identifyUser(address: string, traits?: Record<string, unknown>) {
  if (isDev) {
    console.debug("[Analytics] identify", address, traits);
  }
  // PostHog: posthog.identify(address, traits);
  // Mixpanel: mixpanel.identify(address); mixpanel.people.set(traits);
}

export function trackPageView(path?: string) {
  const pagePath = path || (typeof window !== "undefined" ? window.location.pathname : "/");
  trackEvent("$pageview", { path: pagePath });
}
