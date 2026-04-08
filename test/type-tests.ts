import type {
	Equals,
	Expect,
	HasKey,
	NotAny,
	NotHasKey,
} from "type-test-core";
import { z } from "zod";
import {
	createApiClient,
	createEndpoints,
	defineDefinitions,
	defineEndpoints,
	defineGroups,
} from "../src/index";
import type {
	GroupResolver,
	HandlerTree,
	InferDefinitionInput,
	InferInput,
	InferOutput,
} from "../src/types";

const groups = defineGroups(({ collection, object, value }) => ({
	rootValue: value().cache<number>().cacheLevel<string, "formatted">("formatted"),
	users: collection(
		object({
			name: value(),
			email: value(),
		}).cache<{ id: string; name: string; email: string }>().cacheLevel<
			{ id: string; name: string },
			"list"
		>("list"),
	),
}));

type RootValueEntry = typeof groups.rootValue;
type UserEntry = ReturnType<typeof groups.users>;
type UserNameEntry = ReturnType<typeof groups.users>["name"];
type UserEmailEntry = ReturnType<typeof groups.users>["email"];
type RootValueCache = typeof groups.rootValue.cache;
type RootValueFormattedCache = typeof groups.rootValue.cache.formatted;
type UserCache = ReturnType<typeof groups.users>["cache"];
type UserListCache = ReturnType<typeof groups.users>["cache"]["list"];

type _GroupType1 = Expect<Equals<RootValueEntry["kind"], "value">>;
type _GroupType2 = Expect<Equals<UserEntry["kind"], "object">>;
type _GroupType3 = Expect<Equals<UserNameEntry["kind"], "value">>;
type _GroupType4 = Expect<Equals<UserEmailEntry["kind"], "value">>;
type _GroupType5 = Expect<HasKey<UserEntry, "name">>;
type _GroupType6 = Expect<HasKey<UserEntry, "email">>;
type _GroupType7 = Expect<NotHasKey<RootValueEntry, "name">>;
type _GroupType8 = Expect<Equals<RootValueCache["key"], string>>;
type _GroupType9 = Expect<Equals<RootValueFormattedCache["level"], "formatted">>;
type _GroupType10 = Expect<Equals<UserCache["level"], undefined>>;
type _GroupType11 = Expect<Equals<UserListCache["level"], "list">>;

const staticResolver = [groups.rootValue] satisfies GroupResolver<{}>;
const functionalResolver = ((input: { id: string }) => [
	groups.users(input.id),
]) satisfies GroupResolver<{ id: string }>;

void staticResolver;
void functionalResolver;

const definitions = defineDefinitions<{ auth: "public" | "required" }>()(
	({ query, mutation }) => ({
		status: {
			ping: query({
				auth: "public",
				dependsOn: [groups.rootValue],
			}),
			reset: mutation({
				auth: "required",
				invalidates: [groups.rootValue],
			}),
		},
		rootValue: {
			get: query({
				input: z.object({}),
				auth: "public",
				dependsOn: [groups.rootValue],
			}),
			set: mutation({
				input: z.object({
					value: z.number(),
				}),
				auth: "required",
				invalidates: [groups.rootValue],
			}),
		},
		users: {
			getById: query({
				input: z.object({
					id: z.string(),
				}),
				auth: "public",
				dependsOn: ({ id }) => [groups.users(id)],
			}),
			getNameById: query({
				input: z.object({
					id: z.string(),
				}),
				auth: "public",
				dependsOn: ({ id }) => [groups.users(id).name],
			}),
			updateById: mutation({
				input: z.object({
					id: z.string(),
					name: z.string(),
				}),
				auth: "required",
				invalidates: ({ id }) => [groups.users(id)],
			}),
			updateNameById: mutation({
				input: z.object({
					id: z.string(),
					name: z.string(),
				}),
				auth: "required",
				invalidates: ({ id }) => [groups.users(id).name],
			}),
		},
	}),
);

const handlers = {
	status: {
		ping: async () => "pong",
		reset: async ({ input }) => {
			const value: undefined = input;
			return value;
		},
	},
	rootValue: {
		get: async () => 1,
		set: async ({ input, ctx }) => ({
			value: input.value,
			actorId: ctx.actorId,
		}),
	},
	users: {
		getById: async ({ input }) => {
			const upper = input.id.toUpperCase();
			return { id: upper, name: "User", email: "user@example.com" };
		},
		getNameById: async ({ input }) => {
			const lower = input.id.toLowerCase();
			return { name: lower };
		},
		updateById: async ({ input, ctx }) => {
			return { id: input.id, name: input.name, actorId: ctx.actorId };
		},
		updateNameById: async ({ input }) => {
			return { name: input.name };
		},
	},
} satisfies HandlerTree<typeof definitions, { actorId: string | null }>;

const endpoints = createEndpoints<typeof definitions, { actorId: string | null }, typeof handlers>(
	definitions,
	handlers,
);

const inlineEndpoints = defineEndpoints<{ auth: "public" | "required" }, { actorId: string | null }>()(
	({ query, mutation }) => ({
		status: {
			ping: query({
				auth: "public",
				handler: async () => "pong",
			}),
			reset: mutation({
				auth: "required",
				handler: async ({ input }) => {
					const value: undefined = input;
					return value;
				},
			}),
		},
	}),
);

type InlineApi = typeof inlineEndpoints;
const inlineApi = createApiClient<InlineApi>({
	baseUrl: "http://example.test/api",
	definitions: inlineEndpoints,
	fetch: async () => new Response(),
});
type Api = typeof endpoints;
const api = createApiClient<Api>({
	baseUrl: "http://example.test/api",
	definitions,
	fetch: async () => new Response(),
});

type RootValueDefinitionInput = InferDefinitionInput<typeof definitions.rootValue.get>;
type PingInput = InferDefinitionInput<typeof definitions.status.ping>;
type RootValueOutput = InferOutput<typeof endpoints.rootValue.get>;
type PingOutput = InferOutput<typeof endpoints.status.ping>;
type ResetStatusInput = InferInput<typeof endpoints.status.reset>;
type SetRootValueInput = InferInput<typeof endpoints.rootValue.set>;
type SetRootValueOutput = InferOutput<typeof endpoints.rootValue.set>;
type GetUserOutput = InferOutput<typeof endpoints.users.getById>;
type GetUserNameOutput = InferOutput<typeof endpoints.users.getNameById>;
type UpdateUserOutput = InferOutput<typeof endpoints.users.updateById>;

type _Type1 = Expect<Equals<RootValueDefinitionInput, {}>>;
type _Type1b = Expect<Equals<PingInput, undefined>>;
type _Type1c = Expect<Equals<ResetStatusInput, undefined>>;
type _Type2 = Expect<Equals<RootValueOutput, number>>;
type _Type2b = Expect<Equals<PingOutput, string>>;
type _Type3 = Expect<Equals<SetRootValueInput, { value: number }>>;
type _Type4 = Expect<Equals<SetRootValueOutput, { value: number; actorId: string | null }>>;
type _Type5 = Expect<HasKey<GetUserOutput, "email">>;
type _Type6 = Expect<NotAny<GetUserOutput>>;
type _Type7 = Expect<Equals<GetUserNameOutput, { name: string }>>;
type _Type8 = Expect<Equals<UpdateUserOutput, { id: string; name: string; actorId: string | null }>>;
type UpdateByIdInvalidatesInput = Parameters<
	Extract<typeof definitions.users.updateById.invalidates, (...args: any[]) => any>
>[0];
type _Type9 = Expect<Equals<UpdateByIdInvalidatesInput, { id: string; name: string }>>;
type RootValueFetchOptions = Parameters<typeof api.rootValue.get.fetch>[1];
type RootValueUseQueryOptions = Parameters<typeof api.rootValue.get.useQuery>[1];
type SetMutationOptions = Parameters<typeof api.rootValue.set.useMutation>[0];
type RootValueReadCache = NonNullable<RootValueFetchOptions>["readCache"];
type RootValueReadCacheInput = Parameters<NonNullable<RootValueReadCache>>[1];
type RootValueReadCacheReturn = ReturnType<NonNullable<RootValueReadCache>>;
type RootValueFetchOnSuccess = NonNullable<RootValueFetchOptions>["onSuccess"];
type RootValueFetchOnSuccessPayload = Parameters<NonNullable<RootValueFetchOnSuccess>>[1];
type SetMutationOnSuccess = NonNullable<NonNullable<SetMutationOptions>["onSuccess"]>;
type SetMutationOnSuccessPayload = Parameters<SetMutationOnSuccess>[1];
type _Type10 = Expect<Equals<RootValueReadCacheInput, {}>>;
type _Type11 = Expect<Equals<RootValueReadCacheReturn, number | undefined>>;
type _Type12 = Expect<Equals<RootValueFetchOnSuccessPayload, { data: number; input: {} }>>;
type _Type13 = Expect<
	Equals<
		SetMutationOnSuccessPayload,
		{ data: { value: number; actorId: string | null }; input: { value: number }; context: unknown }
	>
>;
type _Type14 = Expect<Equals<NonNullable<RootValueUseQueryOptions>["cachePolicy"], "refetch" | "prefer" | "only" | "ignore" | undefined>>;
type InlinePingOutput = InferOutput<typeof inlineEndpoints.status.ping>;
type _Type15 = Expect<Equals<InlinePingOutput, string>>;

const validRootInput: RootValueDefinitionInput = {};
const validPingInput: PingInput = undefined;
const validSetInput: SetRootValueInput = { value: 1 };
const validUserOutput: GetUserOutput = { id: "1", name: "User", email: "user@example.com" };
const validAuthValue: (typeof definitions.users.updateById)["auth"] = "required";
const validInvalidatesInput: UpdateByIdInvalidatesInput = { id: "1", name: "User" };
const validRootValueFetchOnSuccess: NonNullable<RootValueFetchOnSuccess> = ({ cache }, { data }) => {
	cache(groups.rootValue.cache, data);
	cache(groups.rootValue.cache.formatted, String(data));
};

// @ts-expect-error missing required input property
const invalidSetInput: SetRootValueInput = {};

const invalidRootValueFetchOnSuccess: NonNullable<RootValueFetchOnSuccess> = ({ cache }, { data }) => {
	// @ts-expect-error wrong cache value type
	cache(groups.rootValue.cache, String(data));
};

const invalidDefinitionsRawStrings = defineDefinitions<{ auth: "public" | "required" }>()(
	({ query }) => ({
		users: {
			bad: query({
				input: z.object({}),
				auth: "public",
				// @ts-expect-error raw strings are no longer valid dependsOn entries
				dependsOn: ["users"],
			}),
		},
	}),
);

const invalidDefinitionsWrongPath = defineDefinitions<{ auth: "public" | "required" }>()(
	({ query }) => ({
		users: {
			bad: query({
				input: z.object({
					id: z.string(),
				}),
				auth: "public",
				dependsOn: ({ id }) => [
					// @ts-expect-error missing path is not declared on the object group
					groups.users(id).missing(),
				],
			}),
		},
	}),
);

const invalidDefinitionsQueryInvalidates = defineDefinitions<{ auth: "public" | "required" }>()(
	({ query }) => ({
		users: {
			bad: query({
				input: z.object({
					id: z.string(),
				}),
				auth: "public",
				// @ts-expect-error queries cannot invalidate groups
				invalidates: ({ id }: { id: string }) => [groups.users(id)],
			}),
		},
	}),
);

const invalidDefinitionsMutationDependsOn = defineDefinitions<{ auth: "public" | "required" }>()(
	({ mutation }) => ({
		users: {
			bad: mutation({
				input: z.object({
					id: z.string(),
				}),
				auth: "required",
				// @ts-expect-error mutations cannot depend on groups
				dependsOn: ({ id }: { id: string }) => [groups.users(id)],
			}),
		},
	}),
);

// @ts-expect-error missing users branch
const invalidHandlersMissingBranch: HandlerTree<typeof definitions> = {
	rootValue: {
		get: async () => 1,
		set: async ({ input }) => ({ value: input.value, actorId: null }),
	},
};

const invalidHandlersMissingHandler: HandlerTree<typeof definitions> = {
	// @ts-expect-error missing updateNameById handler
	users: {
		getById: async () => ({ id: "1", name: "User", email: "user@example.com" }),
		getNameById: async () => ({ name: "User" }),
		updateById: async () => ({ id: "1", name: "User", actorId: null }),
	},
	rootValue: {
		get: async () => 1,
		set: async ({ input }) => ({ value: input.value, actorId: null }),
	},
};

// @ts-expect-error value groups are not callable
groups.rootValue("1");

// @ts-expect-error invalid child accessor
groups.users("1").missing();

// @ts-expect-error collections are not cacheable
groups.users.cache;

void validRootInput;
void validPingInput;
void validSetInput;
void validUserOutput;
void validAuthValue;
void validInvalidatesInput;
void validRootValueFetchOnSuccess;
void invalidSetInput;
void invalidRootValueFetchOnSuccess;
void invalidDefinitionsRawStrings;
void invalidDefinitionsWrongPath;
void invalidDefinitionsQueryInvalidates;
void invalidDefinitionsMutationDependsOn;
void invalidHandlersMissingBranch;
void invalidHandlersMissingHandler;
void inlineApi;
