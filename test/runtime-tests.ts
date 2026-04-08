import process from "node:process";
import { z } from "zod";
import {
	createApiClient,
	createEndpoints,
	createHttpHandler,
	createTrellisApp,
	defineGroups,
	normalizeGroupEntries,
	resolveDependencyGroups,
	resolveInvalidationGroups,
	shouldInvalidateAnyGroup,
	shouldInvalidateDependency,
	TrellisError,
	TrellisHttpError,
} from "../src/index";
import type { DefinitionTree, GroupEntry, HandlerTree } from "../src/index";

let passed = 0;
let failed = 0;
let sharedValue = 0;
let values: Record<0 | 1, { value: number; child: number }> = {
	0: { value: 0, child: 0 },
	1: { value: 0, child: 0 },
};

const groups = defineGroups(({ collection, object, value }) => ({
	sharedValue: value().cache<number>().cacheLevel<string, "formatted">("formatted"),
	values: collection(
		object({
			child: value().cache<number>(),
		}).cache<{ id: 0 | 1; value: number; child: number }>().cacheLevel<
			{ id: 0 | 1; value: number; child: number },
			"snapshot"
		>("snapshot"),
	),
}));

function resetState() {
	sharedValue = 0;
	values = {
		0: { value: 0, child: 0 },
		1: { value: 0, child: 0 },
	};
}

function readValue(id: 0 | 1) {
	return {
		id,
		value: values[id].value,
		child: values[id].child,
	};
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEqual<T>(actual: T, expected: T, label: string) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

async function test(name: string, fn: () => Promise<void>) {
	try {
		resetState();
		await fn();
		passed++;
		console.log(`PASS ${name}`);
	} catch (error) {
		failed++;
		console.error(`FAIL ${name}`);
		console.error((error as Error).message);
	}
}

async function call(
	handler: (request: Request) => Promise<Response>,
	path: string,
	options: {
		method?: string;
		body?: unknown;
		headers?: Record<string, string>;
	} = {},
) {
	const request = new Request(`http://localhost${path}`, {
		method: options.method ?? "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});

	const response = await handler(request);
	return {
		status: response.status,
		json: await response.json(),
	};
}

function keys(entries: readonly GroupEntry[]) {
	return entries.map((entry) => entry.key);
}

const definitions = {
	sharedValue: {
		get: {
			type: "query",
			input: z.object({}),
			auth: "public",
			dependsOn: [groups.sharedValue],
		},
		increment: {
			type: "mutation",
			input: z.object({
				delta: z.number(),
			}),
			auth: "public",
			invalidates: [groups.sharedValue],
		},
	},
	values: {
		list: {
			type: "query",
			input: z.object({}),
			auth: "public",
			dependsOn: [groups.values],
		},
		reset: {
			type: "mutation",
			input: z.object({}),
			auth: "public",
			invalidates: [groups.values],
		},
		getById: {
			type: "query",
			input: z.object({
				id: z.union([z.literal(0), z.literal(1)]),
			}),
			auth: "public",
			dependsOn: ({ id }) => [groups.values(id)],
		},
		getChildById: {
			type: "query",
			input: z.object({
				id: z.union([z.literal(0), z.literal(1)]),
			}),
			auth: "public",
			dependsOn: ({ id }) => [groups.values(id).child],
		},
		incrementById: {
			type: "mutation",
			input: z.object({
				id: z.union([z.literal(0), z.literal(1)]),
				delta: z.number(),
			}),
			auth: "public",
			invalidates: ({ id }) => [groups.values(id)],
		},
		incrementChildById: {
			type: "mutation",
			input: z.object({
				id: z.union([z.literal(0), z.literal(1)]),
				delta: z.number(),
			}),
			auth: "public",
			invalidates: ({ id }) => [groups.values(id).child],
		},
		whoAmI: {
			type: "query",
			input: z.object({}),
			auth: "public",
			dependsOn: [groups.sharedValue],
		},
		fail: {
			type: "query",
			input: z.object({}),
			auth: "public",
		},
	},
} satisfies DefinitionTree<{ auth: "public" | "required" }>;

const handlers: HandlerTree<typeof definitions, { actorId: string | null }> = {
	sharedValue: {
		get: async () => sharedValue,
		increment: async ({ input }) => {
			sharedValue += input.delta;
			return sharedValue;
		},
	},
	values: {
		list: async () => [readValue(0), readValue(1)],
		reset: async () => {
			resetState();
			return [readValue(0), readValue(1)];
		},
		getById: async ({ input }) => readValue(input.id),
		getChildById: async ({ input }) => values[input.id].child,
		incrementById: async ({ input }) => {
			values[input.id].value += input.delta;
			return readValue(input.id);
		},
		incrementChildById: async ({ input }) => {
			values[input.id].child += input.delta;
			return values[input.id].child;
		},
		whoAmI: async ({ ctx }) => ({
			actorId: ctx.actorId,
			headerActorId: ctx.headers["x-actor-id"] ?? null,
			hasRequest: ctx.request instanceof Request,
		}),
		fail: async () => {
			throw new TrellisHttpError(404, "NOT_FOUND", "Missing");
		},
	},
};

async function run() {
	const endpoints = createEndpoints<
		typeof definitions,
		{ actorId: string | null },
		typeof handlers
	>(definitions, handlers);
	const app = createTrellisApp({
		endpoints,
		resolveContext: async (request) => ({
			actorId: request.headers.get("x-actor-id"),
		}),
	});

	const handler = createHttpHandler(app, { basePath: "/api" });
	let fetchCalls = 0;
	const inMemoryFetch: typeof fetch = async (input, init) => {
		fetchCalls++;
		const request = input instanceof Request ? input : new Request(String(input), init);
		return handler(request);
	};

	function createApi() {
		fetchCalls = 0;
		return createApiClient<typeof endpoints>({
			baseUrl: "http://localhost/api",
			definitions,
			fetch: inMemoryFetch,
		});
	}

	await test("nested query endpoint works", async () => {
		const result = await call(handler, "/api/sharedValue.get", {
			body: {},
		});
		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, 0, "value");
	});

	await test("mutation updates shared value", async () => {
		const result = await call(handler, "/api/sharedValue.increment", {
			body: { delta: 2 },
		});
		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, 2, "value");
	});

	await test("list query returns both entries", async () => {
		const result = await call(handler, "/api/values.list", {
			body: {},
		});
		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, [
			{ id: 0, value: 0, child: 0 },
			{ id: 1, value: 0, child: 0 },
		], "values");
	});

	await test("getById returns one entry", async () => {
		values[1].value = 4;
		const result = await call(handler, "/api/values.getById", {
			body: { id: 1 },
		});
		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, { id: 1, value: 4, child: 0 }, "value");
	});

	await test("getChildById returns child value", async () => {
		values[0].child = 3;
		const result = await call(handler, "/api/values.getChildById", {
			body: { id: 0 },
		});
		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, 3, "child");
	});

	await test("reset mutation resets values and child values", async () => {
		values[0].value = 3;
		values[0].child = 4;
		values[1].value = 5;
		values[1].child = 6;

		const result = await call(handler, "/api/values.reset", {
			body: {},
		});

		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, [
			{ id: 0, value: 0, child: 0 },
			{ id: 1, value: 0, child: 0 },
		], "reset");
	});

	await test("whoAmI sees resolved context and headers", async () => {
		const result = await call(handler, "/api/values.whoAmI", {
			body: {},
			headers: {
				"x-actor-id": "actor-1",
			},
		});
		assertEqual(result.status, 200, "status");
		assertEqual(result.json.data, {
			actorId: "actor-1",
			headerActorId: "actor-1",
			hasRequest: true,
		}, "context");
	});

	await test("validation errors return 400", async () => {
		const result = await call(handler, "/api/sharedValue.increment", {
			body: {},
		});
		assertEqual(result.status, 400, "status");
		assertEqual(result.json.error.code, "VALIDATION_ERROR", "code");
	});

	await test("validation errors include issues", async () => {
		const result = await call(handler, "/api/values.getById", {
			body: { id: 9 },
		});
		assertEqual(result.status, 400, "status");
		assert(Boolean(result.json.error.issues?.length), "issues exist");
	});

	await test("missing endpoints return 404", async () => {
		const result = await call(handler, "/api/values.missing", {
			body: {},
		});
		assertEqual(result.status, 404, "status");
	});

	await test("typed errors are preserved", async () => {
		const result = await call(handler, "/api/values.fail", {
			body: {},
		});
		assertEqual(result.status, 404, "status");
		assertEqual(result.json.error.message, "Missing", "message");
	});

	await test("method errors return 405", async () => {
		const result = await call(handler, "/api/sharedValue.get", {
			method: "GET",
		});
		assertEqual(result.status, 405, "status");
	});

	await test("TrellisError stores details", async () => {
		const error = new TrellisError("VALIDATION_ERROR", "Bad input");
		assert(error instanceof Error, "inherits from Error");
		assertEqual(error.code, "VALIDATION_ERROR", "code");
	});

	await test("normalizeGroupEntries returns normalized copies", async () => {
		const original = groups.values(0).child;
		const normalized = normalizeGroupEntries([original])[0];
		assertEqual(normalized.key, "values.0.child", "key");
		assert(original !== normalized, "is cloned");
		assert(original.path !== normalized.path, "path cloned");
	});

	await test("static group dependencies resolve", async () => {
		const resolved = resolveDependencyGroups({}, definitions.sharedValue.get.dependsOn);
		assertEqual(keys(resolved), ["sharedValue"], "keys");
	});

	await test("functional group dependencies resolve", async () => {
		const resolved = resolveDependencyGroups({ id: 0 }, definitions.values.getById.dependsOn);
		assertEqual(keys(resolved), ["values.0"], "keys");
	});

	await test("functional child group dependencies resolve", async () => {
		const resolved = resolveDependencyGroups({ id: 1 }, definitions.values.getChildById.dependsOn);
		assertEqual(keys(resolved), ["values.1.child"], "keys");
	});

	await test("functional invalidation groups resolve", async () => {
		const resolved = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(keys(resolved), ["values.0"], "keys");
	});

	await test("static invalidation groups resolve", async () => {
		const resolved = resolveInvalidationGroups({}, definitions.values.reset.invalidates);
		assertEqual(keys(resolved), ["values"], "keys");
	});

	await test("exact value dependency invalidates on exact value invalidation", async () => {
		const invalidated = resolveInvalidationGroups(
			{ delta: 1 },
			definitions.sharedValue.increment.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.sharedValue, invalidated), true, "exact");
	});

	await test("invalidating an item invalidates the collection", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values, invalidated), true, "collection");
	});

	await test("invalidating an item invalidates the item itself", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 1, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values(1), invalidated), true, "item");
	});

	await test("invalidating an item invalidates its child property", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values(0).child, invalidated), true, "child");
	});

	await test("invalidating a child invalidates itself", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementChildById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values(0).child, invalidated), true, "child");
	});

	await test("invalidating a child invalidates its parent item", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementChildById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values(0), invalidated), true, "item");
	});

	await test("invalidating a child invalidates the collection", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementChildById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values, invalidated), true, "collection");
	});

	await test("invalidating the collection invalidates its item", async () => {
		const invalidated = resolveInvalidationGroups({}, definitions.values.reset.invalidates);
		assertEqual(shouldInvalidateDependency(groups.values(0), invalidated), true, "item");
	});

	await test("invalidating the collection invalidates its child property", async () => {
		const invalidated = resolveInvalidationGroups({}, definitions.values.reset.invalidates);
		assertEqual(shouldInvalidateDependency(groups.values(1).child, invalidated), true, "child");
	});

	await test("invalidating one item does not invalidate a sibling item", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values(1), invalidated), false, "sibling");
	});

	await test("invalidating one item does not invalidate a sibling child", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values(1).child, invalidated), false, "sibling child");
	});

	await test("shared value stays separate from collection groups", async () => {
		const invalidated = resolveInvalidationGroups(
			{ id: 0, delta: 1 },
			definitions.values.incrementById.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.sharedValue, invalidated), false, "sharedValue");
	});

	await test("value group does not invalidate descendants because it has none", async () => {
		const invalidated = resolveInvalidationGroups(
			{ delta: 1 },
			definitions.sharedValue.increment.invalidates,
		);
		assertEqual(shouldInvalidateDependency(groups.values, invalidated), false, "collection");
	});

	await test("shouldInvalidateAnyGroup returns true when one invalidation matches", async () => {
		const invalidated = normalizeGroupEntries([
			groups.sharedValue,
			groups.values(1).child,
		]);
		assertEqual(shouldInvalidateAnyGroup(groups.values(1), invalidated), true, "any");
	});

	await test("shouldInvalidateAnyGroup returns false when none match", async () => {
		const invalidated = normalizeGroupEntries([
			groups.sharedValue,
			groups.values(0),
		]);
		assertEqual(shouldInvalidateAnyGroup(groups.values(1), invalidated), false, "none");
	});

	await test("query fetch can populate and reuse default cache", async () => {
		const api = createApi();
		await api.sharedValue.get.fetch(
			{},
			{
				onSuccess: ({ cache }, { data }) => {
					cache(groups.sharedValue.cache, data);
				},
			},
		);
		assertEqual(fetchCalls, 1, "initial fetch count");

		sharedValue = 9;
		const cached = await api.sharedValue.get.fetch(
			{},
			{
				cachePolicy: "prefer",
				readCache: ({ read }, _input) => read(groups.sharedValue.cache),
			},
		);

		assertEqual(cached, 0, "cached value");
		assertEqual(fetchCalls, 1, "prefer should not fetch");
	});

	await test("query fetch refetch policy uses cache as optional source but still fetches", async () => {
		const api = createApi();
		await api.sharedValue.get.fetch(
			{},
			{
				onSuccess: ({ cache }, { data }) => {
					cache(groups.sharedValue.cache, data);
				},
			},
		);
		fetchCalls = 0;
		sharedValue = 4;

		const value = await api.sharedValue.get.fetch(
			{},
			{
				cachePolicy: "refetch",
				readCache: ({ read }, _input) => read(groups.sharedValue.cache),
			},
		);

		assertEqual(value, 4, "network value");
		assertEqual(fetchCalls, 1, "refetch should fetch");
	});

	await test("query fetch only policy throws on cache miss", async () => {
		const api = createApi();
		let code = "";

		try {
			await api.sharedValue.get.fetch(
				{},
				{
					cachePolicy: "only",
					readCache: ({ read }, _input) => read(groups.sharedValue.cache),
				},
			);
		} catch (error) {
			code = (error as TrellisError).code;
		}

		assertEqual(code, "CACHE_MISS", "miss code");
		assertEqual(fetchCalls, 0, "only should not fetch");
	});

	await test("mutation fetch can write named cache levels", async () => {
		const api = createApi();
		await api.values.incrementById.fetch(
			{ id: 0, delta: 2 },
			{
				onSuccess: ({ cache }, { data, input }) => {
					cache(groups.values(input.id).cache, data);
					cache(groups.values(input.id).cache.snapshot, data);
				},
			},
		);

		values[0].value = 7;
		const cached = await api.values.getById.fetch(
			{ id: 0 },
			{
				cachePolicy: "prefer",
				readCache: ({ read }, { id }) => read(groups.values(id).cache),
			},
		);
		const summary = await api.values.getById.fetch(
			{ id: 0 },
			{
				cachePolicy: "prefer",
				readCache: ({ read }, { id }) => read(groups.values(id).cache.snapshot),
			},
		);

		assertEqual(cached, { id: 0, value: 2, child: 0 }, "default cache");
		assertEqual(summary, { id: 0, value: 2, child: 0 }, "named cache");
	});

	console.log(`Results: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
