/** Error with a code the app translates (errors.<code>). */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code);
  }
}

export const notFound = () => new ApiError('notFound', 404);
export const notAllowed = () => new ApiError('notAllowed', 403);
