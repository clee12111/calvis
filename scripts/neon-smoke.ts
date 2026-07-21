/**
 * Neon smoke test: connect to DATABASE_URL, create tables, insert one row,
 * query it, tear down. Exits 0 on success, 1 on failure with verbatim error.
 */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL not set — Neon smoke test skipped.");
    console.log("Set DATABASE_URL in .env.local to a Neon connection string to test.");
    process.exit(0);
  }

  console.log(`Connecting to Neon: ${url.replace(/\/\/.*@/, "//***@")}...`);

  try {
    // Dynamic import to avoid requiring neon driver when not used
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);

    // Create a test table
    await sql`CREATE TABLE IF NOT EXISTS _smoke_test (id TEXT PRIMARY KEY, ts BIGINT)`;
    console.log("  ✓ CREATE TABLE");

    // Insert
    await sql`INSERT INTO _smoke_test VALUES ('smoke-1', ${Date.now()}) ON CONFLICT DO NOTHING`;
    console.log("  ✓ INSERT");

    // Query
    const rows = await sql`SELECT * FROM _smoke_test WHERE id = 'smoke-1'`;
    console.log(`  ✓ SELECT — got ${rows.length} row(s)`);

    // Teardown
    await sql`DROP TABLE _smoke_test`;
    console.log("  ✓ DROP TABLE");

    console.log("\nNeon smoke test PASSED.");
  } catch (err: any) {
    console.error("\nNeon smoke test FAILED:");
    console.error(err.message ?? err);
    process.exit(1);
  }
}

main();
