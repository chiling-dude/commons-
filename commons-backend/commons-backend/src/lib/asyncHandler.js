// Express 4 does not automatically catch a rejected promise from an async
// route handler — an unhandled rejection there crashes the whole process.
// Wrap every route handler with this so errors reach the error middleware
// (in server.js) as a clean 500 response instead of taking the server down.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
