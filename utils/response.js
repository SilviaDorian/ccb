/**
 * Sends a standardized success JSON response
 */
export function success(res, data = null, message = 'Success', status = 200) {
  return res.status(status).json({
    success: true,
    message,
    data
  });
}

/**
 * Sends a standardized error JSON response
 */
export function error(res, message = 'Something went wrong', status = 400, errors = null) {
  return res.status(status).json({
    success: false,
    message,
    errors
  });
}

export default { success, error };