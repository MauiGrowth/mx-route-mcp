# Security policy

## Reporting a vulnerability

Please report security problems **privately** rather than in a public issue: use the **Report a vulnerability** button on the repository's [Security tab](https://github.com/MauiGrowth/mx-route-mcp/security/advisories/new). Include what you found, how to reproduce it, and the impact you expect. You will get a reply as soon as the maintainers can look at it.

## What is in scope

This server handles an MXroute API key and, for a few tools, mailbox and account passwords. Reports about any of these are especially welcome:

- a path by which the API key or a password could be logged, returned to the model, or sent anywhere other than the configured MXroute API origin;
- a tool argument that could reach a different API endpoint, method or host than the tool declares;
- a way to call a write or destructive tool when `MXROUTE_READ_ONLY` or `MXROUTE_TOOLSETS` should have prevented it.

## Not in scope

- Passwords appearing in your chat transcript because you gave them to the assistant (this is documented behaviour; see the README's Security section).
- Vulnerabilities in MXroute's own API or in your MCP client.

## Supported versions

Only the latest release on the default branch receives fixes.
