import type * as ReactQueryModule from "@tanstack/react-query";
import type {
	ApiResponse,
	AnyDefinition,
	Definition,
	DefinitionTree,
	EndpointKind,
	GroupResolver,
	InferInput,
	InferOutput,
} from "./types";
import {
	type CacheRef,
	type GroupEntry,
	normalizeGroupEntries,
	shouldInvalidateAnyGroup,
} from "./groups";

export interface TrellisClientConfig {
	baseUrl: string;
	headers?: Record<string, string> | (() => Record<string, string>);
	fetch?: typeof fetch;
	reactQuery?: typeof ReactQueryModule;
}

export type CachePolicy = "refetch" | "prefer" | "only" | "ignore";

export type CacheReadTools = {
	read: <T, Level extends string | undefined>(ref: CacheRef<T, Level>) => T | undefined;
};

export type CacheWriteTools = CacheReadTools & {
	cache: <T, Level extends string | undefined>(ref: CacheRef<T, Level>, value: T) => void;
};

export class TrellisError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly issues?: Array<{ path: (string | number)[]; message: string }>,
	) {
		super(message);
		this.name = "TrellisError";
	}
}

export type GroupUpdate = {
	groups: readonly GroupEntry[];
	updatedAt: number;
};

type GroupUpdateListener = (update: GroupUpdate) => void;

type QueryExecutionOptions<I, O> = {
	cachePolicy?: CachePolicy;
	readCache?: (tools: CacheReadTools, input: I) => O | undefined;
	onSuccess?: (tools: CacheWriteTools, payload: { data: O; input: I }) => void | Promise<void>;
};

type QueryHookOptions<I, O> = QueryExecutionOptions<I, O> & {
	enabled?: boolean;
	staleTime?: number;
	refetchInterval?: number;
	refetchOnWindowFocus?: boolean;
};

type MutationExecutionOptions<I, O> = {
	onSuccess?: (
		tools: CacheWriteTools,
		payload: { data: O; input: I; context: unknown },
	) => void | Promise<void>;
	onError?: (error: TrellisError, input: I) => void;
};

type QueryEndpointClient<I, O> = {
	useQuery: (
		input: I,
		options?: QueryHookOptions<I, O>,
	) => {
		data: O | undefined;
		isLoading: boolean;
		error: TrellisError | null;
		refetch: () => void;
	};
	fetch: (input: I, options?: QueryExecutionOptions<I, O>) => Promise<O>;
};

type MutationEndpointClient<I, O> = {
	useMutation: (options?: MutationExecutionOptions<I, O>) => {
		mutate: (input: I) => void;
		mutateAsync: (input: I) => Promise<O>;
		data: O | undefined;
		isLoading: boolean;
		error: TrellisError | null;
	};
	fetch: (input: I, options?: MutationExecutionOptions<I, O>) => Promise<O>;
};

type ClientEndpoint<TEndpoint> = TEndpoint extends { type: EndpointKind }
	? TEndpoint extends { type: "query" }
		? QueryEndpointClient<InferInput<TEndpoint>, InferOutput<TEndpoint>>
		: MutationEndpointClient<InferInput<TEndpoint>, InferOutput<TEndpoint>>
	: never;

export type TrellisClient<TApi> = {
	[K in keyof TApi]: TApi[K] extends { type: EndpointKind }
		? ClientEndpoint<TApi[K]>
		: TrellisClient<TApi[K]>;
};

const groupUpdateListeners = new Set<GroupUpdateListener>();

export function subscribeToGroupUpdates(listener: GroupUpdateListener) {
	groupUpdateListeners.add(listener);
	return () => {
		groupUpdateListeners.delete(listener);
	};
}

function emitGroupUpdate(groups: readonly GroupEntry[]) {
	if (groups.length === 0) {
		return;
	}

	const update: GroupUpdate = {
		groups,
		updatedAt: Date.now(),
	};

	for (const listener of groupUpdateListeners) {
		listener(update);
	}
}

export function resolveDependencyGroups(
	input: unknown,
	dependsOn?: GroupResolver<unknown>,
): GroupEntry[] {
	if (!dependsOn) {
		return [];
	}

	const entries = typeof dependsOn === "function" ? dependsOn(input) : dependsOn;
	return normalizeGroupEntries(entries);
}

export function resolveInvalidationGroups<I = unknown>(
	input: I,
	invalidates?: GroupResolver<I>,
): GroupEntry[] {
	if (!invalidates) {
		return [];
	}

	const entries = typeof invalidates === "function" ? invalidates(input) : invalidates;
	return normalizeGroupEntries(entries);
}

export function shouldInvalidateDependency(
	dependency: GroupEntry,
	invalidated: readonly GroupEntry[],
): boolean {
	return shouldInvalidateAnyGroup(dependency, invalidated);
}

function isDefinition(value: unknown): value is AnyDefinition {
	return Boolean(
		value &&
			typeof value === "object" &&
			"type" in (value as Record<string, unknown>) &&
			"input" in (value as Record<string, unknown>),
	);
}

function getCacheStoreKey<T, Level extends string | undefined>(ref: CacheRef<T, Level>) {
	return `${ref.key}::${ref.level ?? "$default"}`;
}

function createCacheTools(store: Map<string, unknown>): CacheWriteTools {
	return {
		read: <T, Level extends string | undefined>(ref: CacheRef<T, Level>) =>
			store.get(getCacheStoreKey(ref)) as T | undefined,
		cache: <T, Level extends string | undefined>(ref: CacheRef<T, Level>, value: T) => {
			store.set(getCacheStoreKey(ref), value);
		},
	};
}

async function trellisCall<O>(
	config: TrellisClientConfig,
	endpointName: string,
	input: unknown,
): Promise<O> {
	const resolvedHeaders =
		typeof config.headers === "function" ? config.headers() : config.headers ?? {};

	const fetchImpl = config.fetch ?? fetch;
	const response = await fetchImpl(`${config.baseUrl}/${endpointName}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...resolvedHeaders,
		},
		body: JSON.stringify(input),
	});

	let json: ApiResponse<O>;
	try {
		json = (await response.json()) as ApiResponse<O>;
	} catch {
		throw new TrellisError(
			`HTTP_${response.status}`,
			`${endpointName} returned ${response.status} ${response.statusText}`,
		);
	}

	if (!response.ok || json.error) {
		throw new TrellisError(
			json.error?.code ?? `HTTP_${response.status}`,
			json.error?.message ?? `${endpointName} returned ${response.status}`,
			json.error?.issues,
		);
	}

	return json.data;
}

async function executeQuery<I, O>(
	config: TrellisClientConfig,
	cacheTools: CacheWriteTools,
	endpointName: string,
	input: I,
	dependsOn: readonly GroupEntry[],
	options?: QueryExecutionOptions<I, O>,
): Promise<O> {
	const cachePolicy = options?.cachePolicy ?? "refetch";
	const cachedData =
		cachePolicy === "ignore" ? undefined : options?.readCache?.({ read: cacheTools.read }, input);

	if (cachePolicy === "only") {
		if (cachedData !== undefined) {
			emitGroupUpdate(dependsOn);
			return cachedData;
		}

		throw new TrellisError("CACHE_MISS", `No cache entry found for ${endpointName}.`);
	}

	if (cachePolicy === "prefer" && cachedData !== undefined) {
		emitGroupUpdate(dependsOn);
		return cachedData;
	}

	const data = await trellisCall<O>(config, endpointName, input);
	await options?.onSuccess?.(cacheTools, { data, input });
	emitGroupUpdate(dependsOn);
	return data;
}

async function executeMutation<I, O>(
	config: TrellisClientConfig,
	cacheTools: CacheWriteTools,
	endpointName: string,
	input: I,
	options?: MutationExecutionOptions<I, O>,
	context?: unknown,
): Promise<O> {
	const data = await trellisCall<O>(config, endpointName, input);
	await options?.onSuccess?.(cacheTools, { data, input, context });
	return data;
}

function createDefinitionClient(
	endpointName: string,
	definition: AnyDefinition,
	config: TrellisClientConfig,
	cacheStore: Map<string, unknown>,
) {
	const cacheTools = createCacheTools(cacheStore);

	if (definition.type === "query") {
		const queryDefinition = definition as Definition<unknown, Record<string, unknown>, "query">;
		return {
			fetch: (input: unknown, options?: QueryExecutionOptions<unknown, unknown>) =>
				executeQuery(
					config,
					cacheTools,
					endpointName,
					input,
					resolveDependencyGroups(input, queryDefinition.dependsOn),
					options,
				),
			useQuery: (input: unknown, options?: QueryHookOptions<unknown, unknown>) => {
				const rq = getReactQuery(config);
				if (!rq) {
					throw new Error("@tanstack/react-query is required for useQuery.");
				}

				const dependsOn = resolveDependencyGroups(input, queryDefinition.dependsOn);
				const cachePolicy = options?.cachePolicy ?? "refetch";
				const cachedData =
					cachePolicy === "ignore"
						? undefined
						: options?.readCache?.({ read: cacheTools.read }, input);

				return rq.useQuery({
					queryKey: [endpointName, input],
					queryFn: () =>
						executeQuery(
							config,
							cacheTools,
							endpointName,
							input,
							dependsOn,
							options,
						),
					initialData: cachePolicy === "refetch" ? cachedData : undefined,
					meta: {
						trellisDependsOn: dependsOn,
					},
					enabled: options?.enabled,
					staleTime: options?.staleTime,
					refetchInterval: options?.refetchInterval,
					refetchOnWindowFocus: options?.refetchOnWindowFocus,
				});
			},
		};
	}

	const mutationDefinition = definition as Definition<unknown, Record<string, unknown>, "mutation">;
	return {
		fetch: (input: unknown, options?: MutationExecutionOptions<unknown, unknown>) =>
			executeMutation(config, cacheTools, endpointName, input, options),
		useMutation: (options?: MutationExecutionOptions<unknown, unknown>) => {
			const rq = getReactQuery(config);
			if (!rq) {
				throw new Error("@tanstack/react-query is required for useMutation.");
			}

			const queryClient = rq.useQueryClient();
			return rq.useMutation({
				mutationFn: (input: unknown) =>
					executeMutation(config, cacheTools, endpointName, input, options),
				onSuccess: async (data: unknown, input: unknown, context: unknown) => {
					const invalidated = resolveInvalidationGroups(input, mutationDefinition.invalidates);
					await options?.onSuccess?.(cacheTools, { data, input, context });

					if (invalidated.length > 0) {
						await queryClient.invalidateQueries({
							predicate: (query: { meta?: unknown }) => {
								const meta = query.meta as
									| { trellisDependsOn?: readonly GroupEntry[] }
									| undefined;
								const dependsOn = meta?.trellisDependsOn ?? [];
								return dependsOn.some((dependency) =>
									shouldInvalidateDependency(dependency, invalidated),
								);
							},
						});
					}
				},
				onError: (error: unknown, input: unknown) => {
					options?.onError?.(error as TrellisError, input);
				},
			});
		},
	};
}

function createNestedClient<TApi, TTree extends DefinitionTree<any>>(
	tree: TTree,
	config: TrellisClientConfig,
	cacheStore: Map<string, unknown>,
	path: string[] = [],
): TrellisClient<TApi> {
	return Object.fromEntries(
		Object.entries(tree).map(([key, value]) => {
			const nextPath = [...path, key];

			if (isDefinition(value)) {
				const client = createDefinitionClient(nextPath.join("."), value, config, cacheStore);
				return [
					key,
					value.type === "query"
						? {
								fetch: client.fetch,
								useQuery: client.useQuery,
						  }
						: {
								fetch: client.fetch,
								useMutation: client.useMutation,
						  },
				];
			}

			return [
				key,
				createNestedClient<Record<string, unknown>, DefinitionTree<any>>(
					value as DefinitionTree<any>,
					config,
					cacheStore,
					nextPath,
				),
			];
		}),
	) as TrellisClient<TApi>;
}

let reactQuery: typeof import("@tanstack/react-query") | null = null;
let loaded = false;

function getReactQuery(config: TrellisClientConfig) {
	if (config.reactQuery) {
		return config.reactQuery;
	}

	if (!loaded) {
		try {
			const dynamicRequire = new Function("id", "return require(id)") as (id: string) => any;
			reactQuery = dynamicRequire("@tanstack/react-query");
		} catch {
			reactQuery = null;
		}
		loaded = true;
	}

	return reactQuery;
}

export function createApiClient<
	TApi,
	TDefinitions extends DefinitionTree<any> = DefinitionTree<any>,
>(
	config: TrellisClientConfig & { definitions: TDefinitions },
): TrellisClient<TApi> {
	return createNestedClient<TApi, TDefinitions>(config.definitions, config, new Map());
}
