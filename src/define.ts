import { z } from "zod";
import type {
	AnyDefinition,
	Definition,
	DefinitionTree,
	HandlerFor,
	HandlerTree,
	ImplementedEndpoint,
	ImplementedTree,
} from "./types";

type QueryDefinitionInit<I, TExtra extends object> = TExtra & {
	readonly input?: z.ZodType<I>;
	readonly dependsOn?: Definition<I, {}, "query">["dependsOn"];
};

type MutationDefinitionInit<I, TExtra extends object> = TExtra & {
	readonly input?: z.ZodType<I>;
	readonly invalidates?: Definition<I, {}, "mutation">["invalidates"];
};

type DefinitionBuilders<TExtra extends object> = {
	query: {
		(definition: QueryDefinitionInit<undefined, TExtra> & { readonly input?: undefined }): Definition<
			undefined,
			TExtra,
			"query"
		>;
		<I>(definition: QueryDefinitionInit<I, TExtra> & { readonly input: z.ZodType<I> }): Definition<
			I,
			TExtra,
			"query"
		>;
	};
	mutation: {
		(definition: MutationDefinitionInit<undefined, TExtra> & { readonly input?: undefined }): Definition<
			undefined,
			TExtra,
			"mutation"
		>;
		<I>(
			definition: MutationDefinitionInit<I, TExtra> & { readonly input: z.ZodType<I> },
		): Definition<I, TExtra, "mutation">;
	};
};

type QueryEndpointInit<I, TExtra extends object, TContext extends object> = QueryDefinitionInit<I, TExtra> & {
	readonly handler: HandlerFor<Definition<I, TExtra, "query">, TContext, any>;
};

type MutationEndpointInit<I, TExtra extends object, TContext extends object> =
	MutationDefinitionInit<I, TExtra> & {
		readonly handler: HandlerFor<Definition<I, TExtra, "mutation">, TContext, any>;
	};

type EndpointBuilders<TExtra extends object, TContext extends object> = {
	query: {
		<H extends HandlerFor<Definition<undefined, TExtra, "query">, TContext, any>>(
			definition: QueryEndpointInit<undefined, TExtra, TContext> & {
				readonly input?: undefined;
				readonly handler: H;
			},
		): ImplementedEndpoint<Definition<undefined, TExtra, "query">, TContext, H>;
		<I, H extends HandlerFor<Definition<I, TExtra, "query">, TContext, any>>(
			definition: QueryEndpointInit<I, TExtra, TContext> & { readonly input: z.ZodType<I>; readonly handler: H },
		): ImplementedEndpoint<Definition<I, TExtra, "query">, TContext, H>;
	};
	mutation: {
		<H extends HandlerFor<Definition<undefined, TExtra, "mutation">, TContext, any>>(
			definition: MutationEndpointInit<undefined, TExtra, TContext> & {
				readonly input?: undefined;
				readonly handler: H;
			},
		): ImplementedEndpoint<Definition<undefined, TExtra, "mutation">, TContext, H>;
		<I, H extends HandlerFor<Definition<I, TExtra, "mutation">, TContext, any>>(
			definition: MutationEndpointInit<I, TExtra, TContext> & {
				readonly input: z.ZodType<I>;
				readonly handler: H;
			},
		): ImplementedEndpoint<Definition<I, TExtra, "mutation">, TContext, H>;
	};
};

function withDefaultInput<I, TExtra extends object, K extends "query" | "mutation">(
	type: K,
	definition:
		| QueryDefinitionInit<I, TExtra>
		| MutationDefinitionInit<I, TExtra>,
): Definition<I, TExtra, K> {
	return {
		type,
		input: (definition.input ?? z.undefined()) as z.ZodType<I>,
		...definition,
	} as Definition<I, TExtra, K>;
}

function createDefinitionBuilders<TExtra extends object>(): DefinitionBuilders<TExtra> {
	return {
		query: ((definition: QueryDefinitionInit<any, TExtra>) =>
			withDefaultInput("query", definition)) as DefinitionBuilders<TExtra>["query"],
		mutation: ((definition: MutationDefinitionInit<any, TExtra>) =>
			withDefaultInput("mutation", definition)) as DefinitionBuilders<TExtra>["mutation"],
	};
}

function createEndpointBuilders<TExtra extends object, TContext extends object>(): EndpointBuilders<
	TExtra,
	TContext
> {
	return {
		query: ((definition: QueryEndpointInit<any, TExtra, TContext>) =>
			defineQuery<any, TExtra, TContext, any>(definition)) as EndpointBuilders<TExtra, TContext>["query"],
		mutation: ((definition: MutationEndpointInit<any, TExtra, TContext>) =>
			defineMutation<any, TExtra, TContext, any>(
				definition,
			)) as EndpointBuilders<TExtra, TContext>["mutation"],
	};
}

export function defineDefinitions<TExtra extends object>() {
	return function <const TDefinitions extends DefinitionTree<TExtra>>(
		build: (builders: DefinitionBuilders<TExtra>) => TDefinitions,
	): TDefinitions {
		return build(createDefinitionBuilders<TExtra>());
	};
}

export function defineEndpoints<TExtra extends object, TContext extends object = {}>() {
	return function <const TEndpoints extends Record<string, unknown>>(
		build: (builders: EndpointBuilders<TExtra, TContext>) => TEndpoints,
	): TEndpoints {
		return build(createEndpointBuilders<TExtra, TContext>());
	};
}

function isDefinition(value: unknown): value is AnyDefinition {
	return Boolean(
		value &&
			typeof value === "object" &&
			"type" in (value as Record<string, unknown>) &&
			"input" in (value as Record<string, unknown>),
	);
}

export function defineQuery<
	I,
	TExtra extends object = {},
	TContext extends object = {},
	H extends HandlerFor<Definition<I, TExtra, "query">, TContext, any> = HandlerFor<
		Definition<I, TExtra, "query">,
		TContext,
		any
	>,
>(
	definition: QueryDefinitionInit<I, TExtra> & {
		handler: H;
	},
): ImplementedEndpoint<Definition<I, TExtra, "query">, TContext, H> {
	return withDefaultInput("query", definition) as ImplementedEndpoint<
		Definition<I, TExtra, "query">,
		TContext,
		H
	>;
}

export function defineMutation<
	I,
	TExtra extends object = {},
	TContext extends object = {},
	H extends HandlerFor<Definition<I, TExtra, "mutation">, TContext, any> = HandlerFor<
		Definition<I, TExtra, "mutation">,
		TContext,
		any
	>,
>(
	definition: MutationDefinitionInit<I, TExtra> & {
		handler: H;
	},
): ImplementedEndpoint<Definition<I, TExtra, "mutation">, TContext, H> {
	return withDefaultInput("mutation", definition) as ImplementedEndpoint<
		Definition<I, TExtra, "mutation">,
		TContext,
		H
	>;
}

export function createEndpoints<
	TDefinitions extends DefinitionTree<any>,
	TContext extends object,
	THandlers extends HandlerTree<TDefinitions, TContext>,
>(
	definitions: TDefinitions,
	handlers: THandlers,
): ImplementedTree<TDefinitions, THandlers, TContext> {
	function merge(
		definitionTree: DefinitionTree<any>,
		handlerTree: Record<string, unknown>,
	): Record<string, unknown> {
		return Object.fromEntries(
			Object.entries(definitionTree).map(([key, definition]) => {
				const handlerOrTree = handlerTree[key];

				if (isDefinition(definition)) {
					return [
						key,
						{
							...definition,
							handler: handlerOrTree as unknown as HandlerFor<typeof definition, TContext, any>,
						},
					];
				}

				return [
					key,
					merge(definition as DefinitionTree<any>, handlerOrTree as Record<string, unknown>),
				];
			}),
		);
	}

	return merge(definitions, handlers as Record<string, unknown>) as ImplementedTree<
		TDefinitions,
		THandlers,
		TContext
	>;
}
