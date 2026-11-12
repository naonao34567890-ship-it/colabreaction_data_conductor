// Sites identity headers are not trusted on a public Pages deployment.
// Enable persistent Drive access only after migrating authentication and storage.
export function onRequest() {
  return Response.json({state: 'migration_required'}, {
    status: 503,
    headers: {'Cache-Control': 'no-store'},
  });
}
