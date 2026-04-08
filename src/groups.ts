const GROUP_DEFINITION = Symbol("trellis.group.definition");
const GROUP_CACHE_METADATA = Symbol("trellis.group.cache.metadata");

export type GroupKind = "value" | "object" | "collection";

export interface GroupEntry<K extends GroupKind = GroupKind> {
	readonly kind: K;
	readonly key: string;
	readonly path: readonly string[];
}

export interface CacheRef<T = unknown, Level extends string | undefined = undefined> {
	readonly key: string;
	readonly level: Level;
	readonly __type?: T;
}

type CacheMetadata = {
	readonly hasDefault: boolean;
	readonly levels: readonly string[];
};

type HasNamedCaches<TLevels extends Record<string, unknown>> =
	keyof TLevels extends never ? false : true;

type CacheAccessor<
	TDefault = never,
	TNamed extends Record<string, unknown> = {},
> = ([TDefault] extends [never]
	? {}
	: CacheRef<TDefault, undefined>) & {
	readonly [K in keyof TNamed]: CacheRef<TNamed[K], Extract<K, string>>;
	};

type CacheProperty<
	TDefault = never,
	TNamed extends Record<string, unknown> = {},
> = [TDefault] extends [never]
	? HasNamedCaches<TNamed> extends true
		? { readonly cache: CacheAccessor<TDefault, TNamed> }
		: {}
	: { readonly cache: CacheAccessor<TDefault, TNamed> };

type ValueCacheBuilder<
	TDefault = never,
	TNamed extends Record<string, unknown> = {},
> = {
	cache<T>(): ValueGroupDefinition<T, TNamed>;
	cacheLevel<T, TLevel extends string>(
		level: TLevel,
	): ValueGroupDefinition<TDefault, TNamed & Record<TLevel, T>>;
};

type ObjectCacheBuilder<
	TProps extends GroupDefinitionMap,
	TDefault = never,
	TNamed extends Record<string, unknown> = {},
> = {
	cache<T>(): ObjectGroupDefinition<TProps, T, TNamed>;
	cacheLevel<T, TLevel extends string>(
		level: TLevel,
	): ObjectGroupDefinition<TProps, TDefault, TNamed & Record<TLevel, T>>;
};

export interface ValueGroupDefinition<
	TDefault = never,
	TNamed extends Record<string, unknown> = {},
> extends ValueCacheBuilder<TDefault, TNamed> {
	readonly [GROUP_DEFINITION]: "value";
	readonly [GROUP_CACHE_METADATA]?: CacheMetadata;
}

export interface ObjectGroupDefinition<
	TProps extends GroupDefinitionMap,
	TDefault = never,
	TNamed extends Record<string, unknown> = {},
> extends ObjectCacheBuilder<TProps, TDefault, TNamed> {
	readonly [GROUP_DEFINITION]: "object";
	readonly props: TProps;
	readonly [GROUP_CACHE_METADATA]?: CacheMetadata;
}

export interface CollectionGroupDefinition<TItem extends AnyGroupDefinition> {
	readonly [GROUP_DEFINITION]: "collection";
	readonly item: TItem;
}

export type AnyGroupDefinition =
	| ValueGroupDefinition<any, any>
	| ObjectGroupDefinition<GroupDefinitionMap, any, any>
	| CollectionGroupDefinition<AnyGroupDefinition>;

export type GroupDefinitionMap = {
	readonly [key: string]: AnyGroupDefinition;
};

type BaseGroupAccessor<K extends GroupKind = GroupKind> = GroupEntry<K>;
type CollectionGroupAccessor<TItem extends AnyGroupDefinition> = GroupEntry<"collection"> &
	((value: string | number) => GroupAccessor<TItem>);

export type GroupAccessor<TDefinition extends AnyGroupDefinition> =
	TDefinition extends ValueGroupDefinition<infer TDefault, infer TNamed extends Record<string, unknown>>
		? BaseGroupAccessor<"value"> & CacheProperty<TDefault, TNamed>
		: TDefinition extends ObjectGroupDefinition<
					infer TProps extends GroupDefinitionMap,
					infer TDefault,
					infer TNamed extends Record<string, unknown>
			  >
			? BaseGroupAccessor<"object"> &
					{
						readonly [K in keyof TProps]: GroupAccessor<TProps[K]>;
					} &
					CacheProperty<TDefault, TNamed>
			: TDefinition extends CollectionGroupDefinition<infer TItem extends AnyGroupDefinition>
				? CollectionGroupAccessor<TItem>
				: never;

type GroupFactoryApi = {
	value: typeof value;
	object: typeof object;
	collection: typeof collection;
};

type GroupTree<TDefinitions extends GroupDefinitionMap> = {
	readonly [K in keyof TDefinitions]: GroupAccessor<TDefinitions[K]>;
};

function assignGroupEntry<TTarget extends object, K extends GroupKind>(
	target: TTarget,
	kind: K,
	path: readonly string[],
): TTarget & GroupEntry<K> {
	Object.defineProperties(target, {
		kind: {
			value: kind,
			enumerable: true,
		},
		key: {
			value: path.join("."),
			enumerable: true,
		},
		path: {
			value: [...path],
			enumerable: true,
		},
	});
	return target as TTarget & GroupEntry<K>;
}

function createCacheRef<T>(
	key: string,
	level: string | undefined,
): CacheRef<T, string | undefined> {
	return {
		key,
		level,
	};
}

function defineCacheProperty(
	target: object,
	path: readonly string[],
	metadata: CacheMetadata,
) {
	const key = path.join(".");
	const cacheTarget = metadata.hasDefault
		? createCacheRef(key, undefined)
		: {};

	for (const level of metadata.levels) {
		Object.defineProperty(cacheTarget, level, {
			value: createCacheRef(key, level),
			enumerable: true,
		});
	}

	Object.defineProperty(target, "cache", {
		value: cacheTarget,
		enumerable: true,
	});
}

function attachCacheBuilder<TDefinition extends object>(
	definition: TDefinition,
	initial: CacheMetadata = { hasDefault: false, levels: [] },
): TDefinition {
	Object.defineProperty(definition, GROUP_CACHE_METADATA, {
		value: initial,
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(definition, "cache", {
		value: function cache() {
			const current = (definition as TDefinition & {
				readonly [GROUP_CACHE_METADATA]?: CacheMetadata;
			})[GROUP_CACHE_METADATA] ?? { hasDefault: false, levels: [] };

			const next: CacheMetadata = {
				hasDefault: true,
				levels: current.levels,
			};

			return attachCacheBuilder(definition, next);
		},
		enumerable: false,
		configurable: true,
	});

	Object.defineProperty(definition, "cacheLevel", {
		value: function cacheLevel(level: string) {
			const current = (definition as TDefinition & {
				readonly [GROUP_CACHE_METADATA]?: CacheMetadata;
			})[GROUP_CACHE_METADATA] ?? { hasDefault: false, levels: [] };

			const next: CacheMetadata = {
				hasDefault: current.hasDefault,
				levels: current.levels.includes(level) ? current.levels : [...current.levels, level],
			};

			return attachCacheBuilder(definition, next);
		},
		enumerable: false,
		configurable: true,
	});

	return definition;
}

function isObjectDefinition(
	definition: AnyGroupDefinition,
): definition is ObjectGroupDefinition<GroupDefinitionMap, any, any> {
	return definition[GROUP_DEFINITION] === "object";
}

function isCollectionDefinition(
	definition: AnyGroupDefinition,
): definition is CollectionGroupDefinition<AnyGroupDefinition> {
	return definition[GROUP_DEFINITION] === "collection";
}

function getCacheMetadata(definition: AnyGroupDefinition): CacheMetadata | undefined {
	return (definition as ValueGroupDefinition<any, any> | ObjectGroupDefinition<GroupDefinitionMap, any, any>)[
		GROUP_CACHE_METADATA
	];
}

function buildGroupAccessor<TDefinition extends AnyGroupDefinition>(
	definition: TDefinition,
	path: readonly string[],
): GroupAccessor<TDefinition> {
	const accessor = (
		isCollectionDefinition(definition)
			? assignGroupEntry(
					((value: string | number) =>
						buildGroupAccessor(definition.item, [...path, String(value)])) as object,
					"collection",
					path,
			  )
			: assignGroupEntry({}, definition[GROUP_DEFINITION], path)
	) as GroupAccessor<TDefinition>;

	if (isObjectDefinition(definition)) {
		for (const [key, childDefinition] of Object.entries(definition.props)) {
			Object.defineProperty(accessor, key, {
				value: buildGroupAccessor(childDefinition, [...path, key]),
				enumerable: true,
			});
		}
	}

	const cacheMetadata = getCacheMetadata(definition);
	if (cacheMetadata && (cacheMetadata.hasDefault || cacheMetadata.levels.length > 0)) {
		defineCacheProperty(accessor as object, path, cacheMetadata);
	}

	return accessor;
}

function buildGroupTree<TDefinitions extends GroupDefinitionMap>(
	definitions: TDefinitions,
): GroupTree<TDefinitions> {
	return Object.fromEntries(
		Object.entries(definitions).map(([key, definition]) => [
			key,
			buildGroupAccessor(definition, [key]),
		]),
	) as GroupTree<TDefinitions>;
}

export function value(): ValueGroupDefinition {
	return attachCacheBuilder({
		[GROUP_DEFINITION]: "value",
	}) as ValueGroupDefinition;
}

export function object<TProps extends GroupDefinitionMap>(
	props: TProps,
): ObjectGroupDefinition<TProps> {
	return attachCacheBuilder({
		[GROUP_DEFINITION]: "object",
		props,
	}) as ObjectGroupDefinition<TProps>;
}

export function collection<TItem extends AnyGroupDefinition>(
	item: TItem,
): CollectionGroupDefinition<TItem> {
	return {
		[GROUP_DEFINITION]: "collection",
		item,
	};
}

export function defineGroups<TDefinitions extends GroupDefinitionMap>(
	build: (builders: GroupFactoryApi) => TDefinitions,
): GroupTree<TDefinitions> {
	return buildGroupTree(
		build({
			value,
			object,
			collection,
		}),
	);
}

export function normalizeGroupEntry<TEntry extends GroupEntry>(entry: TEntry): GroupEntry<TEntry["kind"]> {
	return {
		kind: entry.kind,
		key: entry.key,
		path: [...entry.path],
	};
}

export function normalizeGroupEntries<TEntry extends GroupEntry>(
	entries: readonly TEntry[],
): GroupEntry<TEntry["kind"]>[] {
	return entries.map((entry) => normalizeGroupEntry(entry));
}

function isPathPrefix(prefix: readonly string[], target: readonly string[]): boolean {
	if (prefix.length > target.length) {
		return false;
	}

	return prefix.every((segment, index) => target[index] === segment);
}

export function shouldInvalidateGroup(
	dependency: GroupEntry,
	invalidated: GroupEntry,
): boolean {
	if (dependency.key === invalidated.key) {
		return true;
	}

	const dependencyIsAncestor = isPathPrefix(dependency.path, invalidated.path);
	if (dependencyIsAncestor) {
		return dependency.kind !== "value";
	}

	const invalidatedIsAncestor = isPathPrefix(invalidated.path, dependency.path);
	if (invalidatedIsAncestor) {
		return invalidated.kind !== "value";
	}

	return false;
}

export function shouldInvalidateAnyGroup(
	dependency: GroupEntry,
	invalidated: readonly GroupEntry[],
): boolean {
	return invalidated.some((entry) => shouldInvalidateGroup(dependency, entry));
}
