/* eslint-env node */
/* global Promise */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const jwksClient = require("jwks-rsa");
const { get, run } = require("./db");

function parseGoogleClientIds() {
  const raw = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isGoogleOAuthConfigured() {
  return parseGoogleClientIds().length > 0;
}

function isAppleOAuthConfigured() {
  return Boolean(String(process.env.APPLE_CLIENT_ID || "").trim());
}

function getPublicOAuthConfig() {
  const ids = parseGoogleClientIds();
  return {
    google_oauth_client_id: ids[0] || "",
    apple_oauth_client_id: String(process.env.APPLE_CLIENT_ID || "").trim(),
    apple_oauth_redirect_uri: String(process.env.APPLE_OAUTH_REDIRECT_URI || "").trim(),
  };
}

async function verifyGoogleIdToken(idToken) {
  const audiences = parseGoogleClientIds();
  if (!audiences.length) {
    const err = new Error("Google OAuth is not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const client = new OAuth2Client();
  const audience = audiences.length === 1 ? audiences[0] : audiences;
  const ticket = await client.verifyIdToken({ idToken, audience });
  const p = ticket.getPayload();
  if (!p?.sub) {
    const err = new Error("Invalid Google credential");
    err.code = "INVALID";
    throw err;
  }
  const email = String(p.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    const err = new Error("Google did not return an email for this account");
    err.code = "INVALID";
    throw err;
  }
  if (p.email_verified === false) {
    const err = new Error("Google email is not verified");
    err.code = "INVALID";
    throw err;
  }
  return {
    sub: String(p.sub),
    email,
    name: String(p.name || "").trim() || email.split("@")[0],
    picture: String(p.picture || "").trim() || null,
  };
}

const appleJwks = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxAge: 86400000,
});

function appleSigningKeyCallback(header, callback) {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    try {
      callback(null, key.getPublicKey());
    } catch (e) {
      callback(e);
    }
  });
}

async function verifyAppleIdToken(idToken) {
  const audience = String(process.env.APPLE_CLIENT_ID || "").trim();
  if (!audience) {
    const err = new Error("Apple Sign In is not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const payload = await new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      appleSigningKeyCallback,
      {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
        audience,
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
  if (!payload?.sub) {
    const err = new Error("Invalid Apple credential");
    err.code = "INVALID";
    throw err;
  }
  const email = payload.email ? String(payload.email).trim().toLowerCase() : "";
  return {
    sub: String(payload.sub),
    email: email || null,
    name: null,
    picture: null,
  };
}

function sanitizePictureUrl(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 2048) return null;
  if (!/^https:\/\//i.test(s)) return null;
  return s;
}

async function upsertOAuthUser(provider, claims) {
  const sub = String(claims.sub || "").trim();
  if (!sub) {
    const err = new Error("Missing subject");
    err.code = "INVALID";
    throw err;
  }
  const email = claims.email ? String(claims.email).trim().toLowerCase() : null;
  const name = claims.name != null ? String(claims.name).trim() : "";
  const pic = sanitizePictureUrl(claims.picture);
  const now = new Date().toISOString();

  const oauthRow = await get(`SELECT id FROM users WHERE oauth_provider = ? AND oauth_sub = ?`, [
    provider,
    sub,
  ]);
  if (oauthRow) {
    await run(
      `UPDATE users SET last_activity_at=?,
         name = COALESCE(NULLIF(TRIM(?), ''), name),
         email = COALESCE(NULLIF(?, ''), email),
         avatar_url = COALESCE(?, avatar_url)
       WHERE id=?`,
      [now, name || null, email || null, pic, oauthRow.id]
    );
    return oauthRow.id;
  }

  if (email) {
    const byEmail = await get(
      `SELECT id, oauth_provider, oauth_sub FROM users WHERE LOWER(TRIM(email)) = ?`,
      [email]
    );
    if (byEmail) {
      const op = byEmail.oauth_provider ? String(byEmail.oauth_provider).trim() : "";
      const os = byEmail.oauth_sub ? String(byEmail.oauth_sub).trim() : "";
      if (op && os && (op !== provider || os !== sub)) {
        const err = new Error("This email is already registered with another sign-in method");
        err.code = "CONFLICT";
        throw err;
      }
      await run(
        `UPDATE users SET oauth_provider=?, oauth_sub=?, last_activity_at=?,
         name = COALESCE(NULLIF(TRIM(?), ''), name),
         email = COALESCE(NULLIF(?, ''), email),
         avatar_url = COALESCE(?, avatar_url),
         credentials_acknowledged = 1
         WHERE id=?`,
        [provider, sub, now, name || null, email || null, pic, byEmail.id]
      );
      return byEmail.id;
    }
  }

  const randomPw = crypto.randomBytes(32).toString("hex");
  const hash = await bcrypt.hash(randomPw, 10);
  const displayName =
    (name && String(name).trim()) || (email ? email.split("@")[0] : "Apple User");
  const result = await run(
    `INSERT INTO users (name, email, phone, password_hash, role, oauth_provider, oauth_sub, avatar_url, credentials_acknowledged)
     VALUES (?, ?, NULL, ?, 'user', ?, ?, ?, 1)`,
    [displayName, email, hash, provider, sub, pic]
  );
  return result.id;
}

async function handleOAuthSignIn(provider, idToken, clientSuppliedName) {
  let claims;
  if (provider === "google") {
    claims = await verifyGoogleIdToken(idToken);
  } else if (provider === "apple") {
    claims = await verifyAppleIdToken(idToken);
    const n = String(clientSuppliedName || "").trim();
    if (n) claims.name = n;
    if (!claims.name) {
      if (claims.email) claims.name = claims.email.split("@")[0];
      else claims.name = "Apple User";
    }
  } else {
    const err = new Error("Unsupported provider");
    err.code = "BAD_PROVIDER";
    throw err;
  }
  const userId = await upsertOAuthUser(provider, claims);
  const user = await get(
    `SELECT id, name, phone, email, role, credentials_acknowledged, notifications_enabled, avatar_url FROM users WHERE id=?`,
    [userId]
  );
  if (!user) throw new Error("User not found after OAuth");
  return user;
}

module.exports = {
  isGoogleOAuthConfigured,
  isAppleOAuthConfigured,
  getPublicOAuthConfig,
  handleOAuthSignIn,
  parseGoogleClientIds,
};
