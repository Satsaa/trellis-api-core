import type {
	AnyEndpoint,
	ApiResponse,
	EndpointRegistry,
	TrellisApp,
	TrellisContext,
	TrellisHttpError,
} from "./types";

function jsonResponse<T>(body: ApiResponse<T>, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function headersToObject(headers: Headers): Record<string, string> {
	const values: Record<string, string> = {};
	headers.forEach((value, key) => {
		values[key] = value;
	});
	return values;
}

async function readInput(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return {};
	}
}

function normalizePath(pathname: string, basePath = ""): string {
	const cleanBase = basePath.replace(/\/+$/, "");
	if (cleanBase && pathname.startsWith(cleanBase)) {
		return pathname.slice(cleanBase.length).replace(/^\/+/, "");
	}
	return pathname.replace(/^\/+/, "");
}

function isEndpoint(value: unknown): value is AnyEndpoint {
	return Boolean(
		value &&
			typeof value === "object" &&
			"type" in (value as Record<string, unknown>) &&
			"input" in (value as Record<string, unknown>) &&
			"handler" in (value as Record<string, unknown>),
	);
}

function flattenEndpoints(source: Record<string, unknown>, prefix = ""): EndpointRegistry {
	const entries: Array<[string, AnyEndpoint]> = [];

	for (const [key, value] of Object.entries(source)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (isEndpoint(value)) {
			entries.push([path, value]);
			continue;
		}

		entries.push(...Object.entries(flattenEndpoints(value as Record<string, unknown>, path)));
	}

	return Object.fromEntries(entries);
}

export function createTrellisApp<TEndpoints extends Record<string, unknown>, TContext extends object = {}>(
	config: {
		endpoints: TEndpoints;
		resolveContext?: (request: Request) => Promise<TContext> | TContext;
	},
): TrellisApp<TEndpoints, TContext> {
	return {
		endpoints: config.endpoints,
		flatEndpoints: flattenEndpoints(config.endpoints),
		resolveContext: config.resolveContext ?? (() => ({}) as TContext),
	};
}

export async function executeEndpoint<TContext extends object>(
	endpoint: AnyEndpoint,
	request: Request,
	context: TrellisContext<TContext>,
): Promise<Response> {
	const rawInput = await readInput(request);
	const parsed = endpoint.input.safeParse(rawInput);

	if (!parsed.success) {
		return jsonResponse(
			{
				data: null,
				error: {
					code: "VALIDATION_ERROR",
					message: "Invalid input",
					issues: parsed.error.issues.map((issue: (typeof parsed.error.issues)[number]) => ({
						path: issue.path,
						message: issue.message,
					})),
				},
			},
			400,
		);
	}

	try {
		const data = await endpoint.handler({
			input: parsed.data,
			ctx: context,
		});

		return jsonResponse({ data, error: null }, 200);
	} catch (error) {
		if (error instanceof Error && "status" in error && "code" in error) {
			const typedError = error as TrellisHttpError;
			return jsonResponse(
				{
					data: null,
					error: {
						code: typedError.code,
						message: typedError.message,
						issues: typedError.issues,
					},
				},
				typedError.status,
			);
		}

		const message = error instanceof Error ? error.message : "Unknown error";
		return jsonResponse(
			{
				data: null,
				error: {
					code: "INTERNAL_ERROR",
					message,
				},
			},
			500,
		);
	}
}

export function createHttpHandler<TEndpoints extends Record<string, unknown>, TContext extends object = {}>(
	app: TrellisApp<TEndpoints, TContext>,
	options?: { basePath?: string },
): (request: Request) => Promise<Response> {
	return async (request: Request) => {
		if (request.method !== "POST") {
			return jsonResponse(
				{
					data: null,
					error: {
						code: "VALIDATION_ERROR",
						message: `Method ${request.method} not allowed. Use POST.`,
					},
				},
				405,
			);
		}

		const url = new URL(request.url);
		const endpointName = normalizePath(url.pathname, options?.basePath);
		const endpoint = app.flatEndpoints[endpointName];

		if (!endpoint) {
			return jsonResponse(
				{
					data: null,
					error: {
						code: "NOT_FOUND",
						message: `Unknown endpoint: ${endpointName}`,
					},
				},
				404,
			);
		}

		const resolvedContext = await app.resolveContext(request);
		return executeEndpoint(endpoint, request, {
			...resolvedContext,
			headers: headersToObject(request.headers),
			request,
		});
	};
}
