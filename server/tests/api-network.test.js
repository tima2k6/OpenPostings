const assert = require("assert");
const { DEFAULT_API_HOST, getApiHost, isLocalAppOrigin, createOriginPolicy } = require("../config/api-network.js");

assert.strictEqual(DEFAULT_API_HOST, "127.0.0.1");
assert.strictEqual(getApiHost({}), "127.0.0.1");
assert.strictEqual(getApiHost({ OPENPOSTINGS_ALLOW_LAN: "true" }), "0.0.0.0");
assert.strictEqual(getApiHost({ OPENPOSTINGS_API_HOST: "192.168.1.4" }), "192.168.1.4");
assert.strictEqual(isLocalAppOrigin("http://localhost:8081"), true);
assert.strictEqual(isLocalAppOrigin("http://127.0.0.1:19006"), true);
assert.strictEqual(isLocalAppOrigin("https://example.com"), false);

function check(policy, origin) {
  return new Promise((resolve) => policy(origin, (error, allowed) => resolve({ error, allowed })));
}

(async () => {
  assert.strictEqual((await check(createOriginPolicy({}), undefined)).allowed, true, "native clients have no Origin header");
  assert.strictEqual((await check(createOriginPolicy({}), "https://example.com")).allowed, false);
  assert.strictEqual(
    (await check(createOriginPolicy({ OPENPOSTINGS_CORS_ORIGINS: "https://example.com" }), "https://example.com")).allowed,
    true
  );
  assert.strictEqual(
    (await check(createOriginPolicy({ OPENPOSTINGS_ALLOW_REMOTE_ORIGINS: "1" }), "https://anywhere.example")).allowed,
    true
  );
  console.log("api-network tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
