try {
  await import('../dist/server.mjs');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to start API-backed routing.');
  process.exitCode = 1;
}
