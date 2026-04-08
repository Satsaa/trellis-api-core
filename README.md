# `trellis-api-core` Usage

`trellis-api-core` provides typed endpoint definitions, an HTTP handler, and a typed client-side contract.

## Define endpoints

```ts
import { z } from "zod";
import { defineEndpoints } from "trellis-api-core";

const endpoints = defineEndpoints<{}, { userId: string }>()(({ query, mutation }) => ({
	health: query({
		handler: async () => ({ ok: true }),
	}),
	todos: {
		list: query({
			input: z.object({ search: z.string().optional() }),
			handler: async ({ input, ctx }) => ({
				userId: ctx.userId,
				search: input.search ?? null,
			}),
		}),
		create: mutation({
			input: z.object({ title: z.string().min(1) }),
			handler: async ({ input }) => ({ id: "todo_1", title: input.title }),
		}),
	},
}));
```

## Serve over HTTP

```ts
import { createHttpHandler, createTrellisApp } from "trellis-api-core";

const app = createTrellisApp({
	endpoints,
	resolveContext: async () => ({ userId: "user_1" }),
});

export const handleRequest = createHttpHandler(app, { basePath: "/api" });
```

Requests are `POST /api/<dot.path.endpoint>` with a JSON body matching the endpoint input schema.

## Separate definitions from handlers

```ts
import { createEndpoints, defineDefinitions } from "trellis-api-core";

const definitions = defineDefinitions<{}>()(({ query }) => ({
	health: query({}),
}));

const implemented = createEndpoints(definitions, {
	health: async () => ({ ok: true }),
});
```
