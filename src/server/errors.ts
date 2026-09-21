export class ApplicationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApplicationApiError";
  }
}

export function requireResource<T>(value: T | null | undefined, resource: string): T {
  if (value === null || value === undefined) {
    throw new ApplicationApiError(404, `${resource} was not found.`);
  }
  return value;
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export class OperationForbiddenError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "OperationForbiddenError";
  }
}
