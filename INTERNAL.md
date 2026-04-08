# `trellis-api-core` Internal Notes

`trellis-api-core` is a typed transport layer, not an RPC framework with hidden conventions.

## Invariants

- Endpoint definitions are plain objects with explicit `query` or `mutation` type.
- Input validation always runs through the endpoint's Zod schema.
- Server and client types derive from the same definition tree.
- Endpoint names flatten from nested objects into dot-paths.

## Structure

- [`src/define.ts`](./src/define.ts) builds definitions and implemented endpoint trees.
- [`src/app.ts`](./src/app.ts) flattens the tree and executes HTTP requests.
- [`src/client.ts`](./src/client.ts) owns client-side typing and invalidation helpers.
- [`src/groups.ts`](./src/groups.ts) models dependency and invalidation groups.

## Rules

- Keep endpoint shapes direct and serializable.
- Prefer strengthening types over adding resolver or adapter helpers.
