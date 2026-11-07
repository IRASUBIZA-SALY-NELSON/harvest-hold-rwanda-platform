/** Name of the httpOnly cookie that holds the admin session token (never readable by page scripts). */
export const SESSION_COOKIE = 'hh_admin';
/** Header every browser request must carry on changes; a cross-site form cannot add it (CSRF protection). */
export const CSRF_HEADER = 'x-hh-request';
