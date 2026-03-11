import { betterstackEnabled, sendLog } from "./services/betterstack-logger.js";

const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function patchConsoleMethod(name, level) {
  console[name] = (...args) => {
    original[name](...args);
    sendLog(level, args);
  };
}

patchConsoleMethod("log", "info");
patchConsoleMethod("info", "info");
patchConsoleMethod("warn", "warning");
patchConsoleMethod("error", "error");
patchConsoleMethod("debug", "debug");

if (betterstackEnabled()) {
  original.info("[Logging] Better Stack sink enabled.");
} else {
  original.info("[Logging] Better Stack sink disabled (missing token/url).");
}
