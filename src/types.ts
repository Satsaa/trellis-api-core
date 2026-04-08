import type { z } from "zod";
import type { GroupEntry } from "./groups";

export type EndpointKind = "query" | "mutation";
export type MaybePromise<T> = T | Promise<T>;
export type GroupResolver<I> = readonly GroupEntry[] | ((input: I) => readonly GroupEntry[]);

export type TrellisContext<TContext extends object = {}> = TContext & {
	headers: Record<string, string>;
	request: Request;
};

export interface HandlerParams<I = unknown, TContext extends object = {}> {
	input: I;
	ctx: TrellisContext<TContext>;
}

export type Definition<
	I = unknown,
	TExtra extends object = {},
	K extends EndpointKind = EndpointKind,
> = TExtra &
	(K extends "query"
		? {
				readonly type: K;
				readonly input: z.ZodType<I>;
				readonly dependsOn?: GroupResolver<I>;
		  }
		: {
				readonly type: K;
				readonly input: z.ZodType<I>;
				readonly invalidates?: GroupResolver<I>;
		  });

export type AnyDefinition = {
	readonly type: EndpointKind;
	readonly input: z.ZodType<any>;
};

export type DefinitionTree<TExtra extends object = {}> = {
	readonly [key: string]: DefinitionTree<TExtra> | Definition<any, TExtra, EndpointKind>;
};

export type InferDefinitionInput<D> = D extends { input: z.ZodType<infer I> } ? I : never;

export type HandlerFor<
	D extends AnyDefinition,
	TContext extends object = {},
	O = unknown,
> = (params: HandlerParams<InferDefinitionInput<D>, TContext>) => MaybePromise<O>;

export type HandlerTree<TDefinitions, TContext extends object = {}> = {
	[K in keyof TDefinitions]: TDefinitions[K] extends AnyDefinition
		? HandlerFor<TDefinitions[K], TContext, any>
		: HandlerTree<TDefinitions[K], TContext>;
};

export type ImplementedEndpoint<
	D extends AnyDefinition = AnyDefinition,
	TContext extends object = {},
	H extends HandlerFor<D, TContext, any> = HandlerFor<D, TContext, any>,
> = D & {
	readonly _input: InferDefinitionInput<D>;
	readonly _output: Awaited<ReturnType<H>>;
	readonly _context: TContext;
	readonly handler: H;
};

export type AnyEndpoint = ImplementedEndpoint<AnyDefinition, any, any>;

export type ImplementedTree<TDefinitions, THandlers, TContext extends object = {}> = {
	[K in keyof TDefinitions]: TDefinitions[K] extends AnyDefinition
		? K extends keyof THandlers
			? THandlers[K] extends HandlerFor<TDefinitions[K], TContext, any>
				? ImplementedEndpoint<TDefinitions[K], TContext, THandlers[K]>
				: never
			: never
		: K extends keyof THandlers
			? ImplementedTree<TDefinitions[K], THandlers[K], TContext>
			: never;
};

export type EndpointRegistry = Record<string, AnyEndpoint>;

export type InferInput<R> = R extends { _input: infer I } ? I : never;
export type InferOutput<R> = R extends { _output: infer O } ? O : never;
export type InferContext<R> = R extends { _context: infer C } ? C : never;

export interface SuccessResponse<T = unknown> {
	data: T;
	error: null;
}

export interface ErrorResponse {
	data: null;
	error: {
		code: "VALIDATION_ERROR" | "UNAUTHORIZED" | "NOT_FOUND" | "INTERNAL_ERROR";
		message: string;
		issues?: Array<{ path: (string | number)[]; message: string }>;
	};
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

export class TrellisHttpError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: ErrorResponse["error"]["code"],
		message: string,
		public readonly issues?: Array<{ path: (string | number)[]; message: string }>,
	) {
		super(message);
		this.name = "TrellisHttpError";
	}
}

export interface TrellisApp<TEndpoints, TContext extends object = {}> {
	endpoints: TEndpoints;
	flatEndpoints: EndpointRegistry;
	resolveContext: (request: Request) => Promise<TContext> | TContext;
}
