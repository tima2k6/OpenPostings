const DEFAULT_API_HOST = "127.0.0.1";

function normalizeBooleanEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getApiHost(env = process.env) {
  const explicit = String(env.OPENPOSTINGS_API_HOST || "").trim();
  if (explicit) return explicit;
  return normalizeBooleanEnv(env.OPENPOSTINGS_ALLOW_LAN) ? "0.0.0.0" : DEFAULT_API_HOST;
}

function splitOrigins(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isLocalAppOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(hostname) && ["http:", "https:"].includes(parsed.protocol)) {
      return true;
    }
    // React Native Windows packaged apps may identify their WebView with an app origin.
    return ["ms-appx:", "ms-appx-web:", "chrome-extension:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function createOriginPolicy(env = process.env) {
  const allowAny = normalizeBooleanEnv(env.OPENPOSTINGS_ALLOW_REMOTE_ORIGINS);
  const configured = new Set(splitOrigins(env.OPENPOSTINGS_CORS_ORIGINS));
  return function originPolicy(origin, callback) {
    const allowed = allowAny || isLocalAppOrigin(origin) || configured.has(String(origin || ""));
    callback(allowed ? null : new Error(`CORS origin is not allowed: ${origin}`), allowed);
  };
}

module.exports = { DEFAULT_API_HOST, getApiHost, isLocalAppOrigin, createOriginPolicy };
