import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidHost, isValidUpstream } from "./routes.js";
import { renderMap } from "./caddy.js";

const DOMAIN = "edge.example.com";

test("isValidHost accepts exactly one label under the edge domain", () => {
  assert.ok(isValidHost(`sess-abc123.${DOMAIN}`, DOMAIN));
  assert.ok(!isValidHost(DOMAIN, DOMAIN));
  assert.ok(!isValidHost(`a.b.${DOMAIN}`, DOMAIN)); // two labels — outside *.domain
  assert.ok(!isValidHost("sess-x.evil.com", DOMAIN));
  assert.ok(!isValidHost(`-bad.${DOMAIN}`, DOMAIN));
  assert.ok(!isValidHost(`UPPER.${DOMAIN}`, DOMAIN));
});

test("isValidUpstream accepts IPv4:port only", () => {
  assert.ok(isValidUpstream("10.116.0.7:8080"));
  assert.ok(!isValidUpstream("10.116.0.7"));
  assert.ok(!isValidUpstream("300.1.1.1:80"));
  assert.ok(!isValidUpstream("10.0.0.1:0"));
  assert.ok(!isValidUpstream("10.0.0.1:70000"));
  assert.ok(!isValidUpstream("host.name:80"));
});

test("isValidUpstream accepts RFC1918 + CGNAT and rejects non-private upstreams", () => {
  assert.ok(isValidUpstream("10.0.0.1:80"));
  assert.ok(isValidUpstream("172.16.0.1:80"));
  assert.ok(isValidUpstream("172.31.255.254:80"));
  assert.ok(isValidUpstream("192.168.1.1:80"));
  assert.ok(isValidUpstream("100.64.0.1:80"));
  assert.ok(isValidUpstream("100.127.255.254:80"));
  // loopback / link-local / metadata endpoint / multicast / public — SSRF sinks
  assert.ok(!isValidUpstream("127.0.0.1:80"));
  assert.ok(!isValidUpstream("127.0.0.2:80"));
  assert.ok(!isValidUpstream("169.254.169.254:80"));
  assert.ok(!isValidUpstream("169.254.0.1:80"));
  assert.ok(!isValidUpstream("224.0.0.1:80"));
  assert.ok(!isValidUpstream("8.8.8.8:80"));
  assert.ok(!isValidUpstream("1.2.3.4:80"));
  assert.ok(!isValidUpstream("192.88.99.1:80"));
});

test("renderMap emits one 'host upstream' line per route", () => {
  assert.equal(renderMap({}), "");
  assert.equal(
    renderMap({ [`a.${DOMAIN}`]: "10.0.0.1:8080", [`b.${DOMAIN}`]: "10.0.0.2:8080" }),
    `a.${DOMAIN} 10.0.0.1:8080\nb.${DOMAIN} 10.0.0.2:8080\n`,
  );
});
