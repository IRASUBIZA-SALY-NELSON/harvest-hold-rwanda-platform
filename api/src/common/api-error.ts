/** Error with a code the apps translate (errors.<code>). */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 400,
    /** Extra details for the admin portal (never secrets). */
    public details?: Record<string, unknown>
  ) {
    super(code);
  }
}

export const notFound = () => new ApiError('notFound', 404);
export const notAllowed = () => new ApiError('notAllowed', 403);
