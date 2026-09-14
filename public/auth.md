# Automated Agent Authentication (OAuth 2.1 client credentials)

This document describes how automated agents and developer tooling authenticate
against the United Traffic Tickets Defense platform so they can call protected
endpoints (`/agent/*` and, in the future, other protected APIs) on your behalf.

## Quick summary

1. An operator registers a **client** (a named credential pair) in the KV store.
2. The client calls `POST https://unitedtraffictickets.com/oauth2/token` with
   `grant_type=client_credentials` to receive a short-lived access token.
3. The client sends that token as `Authorization: Bearer <token>` on protected
   requests. The identity of the caller can be verified via
   `GET https://unitedtraffictickets.com/agent/identity`.

Tokens expire quickly (default 1 hour) and can be revoked immediately. No user
password or browser flow is involved; this is only for machine-to-machine
automation.

## Grant type

Only the OAuth 2.1 `client_credentials` grant is supported. There is no
authorization-code or authorization-owner flow. Clients authenticate either with
`client_id` + `client_secret` in the form body, or with HTTP Basic auth
(`client_id:client_secret` encoded as base64).

## Client registration (operator-only, written to KV)

A client is a JSON record in the `CASES` KV namespace under key
`agent:client:<clientId>`:

    {
      "id": "my-agent",
      "name": "My internal automation",
      "scopes": ["agent", "cases:read"],
      "roles": ["support"],
      "secretHash": "<salted SHA-256 of  clientId:clientSecret>",
      "disabled": false
    }

The secret is never stored in plaintext. To compute `secretHash`, use the same
salted SHA-256 (base64url) the server uses:

    key = clientId + ":" + clientSecret
    secretHash = base64url( SHA-256(key) )

> If you use Cloudflare Wrangler to add a client:
>
>     # 1. generate a secret (do not reuse production secrets for tooling):
>     node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
>     # 2. create the record (replace placeholders):
>     npx wrangler kv key put --binding=CASES "agent:client:my-agent" '{"id":"my-agent","name":"My internal automation","scopes":["agent","cases:read"],"roles":["support"],"secretHash":"<computed hash>","disabled":false}'

## Getting a token

Form-encoded body:

    POST /oauth2/token
    Content-Type: application/x-www-form-urlencoded

    grant_type=client_credentials&client_id=my-agent&client_secret=THE_SECRET&scope=agent cases:read

Or with HTTP Basic auth:

    POST /oauth2/token
    Content-Type: application/x-www-form-urlencoded
    Authorization: Basic base64(my-agent:THE_SECRET)

    grant_type=client_credentials

JSON body is also accepted (`Content-Type: application/json`).

### Success response (200)

    {
      "access_token": "eyJ...",
      "token_type": "Bearer",
      "expires_in": 3600,
      "scope": "agent cases:read"
    }

### Failure responses (4xx)

| error | meaning |
|---|---|
| `invalid_request` | `grant_type` missing, or no credentials supplied |
| `unsupported_grant_type` | grant other than `client_credentials` |
| `invalid_client` | unknown client or wrong secret |
| `invalid_scope` | requested scope not permitted for this client |

## Using the token

Send it on protected requests:

    GET /agent/identity
    Authorization: Bearer eyJ...

The `/agent/identity` response confirms who you are:

    {
      "ok": true,
      "client_id": "my-agent",
      "name": "My internal automation",
      "scope": "agent cases:read",
      "roles": ["support"],
      "expires_at": "2026-09-14T12:00:00.000Z"
    }

To obtain the raw JWT claims (useful for automation that wants expiry/issuer
without parsing JWTs):

    POST /agent/identity/claim
    Authorization: Bearer eyJ...

or

    POST /agent/identity/claim
    Content-Type: application/json

    {"token": "eyJ..."}

## Revoking a token

    POST /oauth2/revoke
    Content-Type: application/x-www-form-urlencoded

    token=eyJ...

Always returns `200 {}` whether or not the token was recognized. Once revoked,
the token is rejected for the rest of its natural lifetime.

## Discovery metadata

- Authorization server metadata (RFC 8414):
  `https://unitedtraffictickets.com/.well-known/oauth-authorization-server`
- Protected resource metadata (RFC 9728):
  `https://unitedtraffictickets.com/.well-known/oauth-protected-resource`

## Security notes

- Do **not** store `client_secret` in source code or commit it to git.
- Prefer short-lived tokens and revoke them when they are no longer needed.
- Each automation should use its own client id so activity is attributable.
- Use the narrowest set of scopes the automation actually needs.