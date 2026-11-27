const { runRegisteredMigration } = require('./run_registered_migration');

async function main() {
  await runRegisteredMigration('fee-overrides-staff-attendance');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
