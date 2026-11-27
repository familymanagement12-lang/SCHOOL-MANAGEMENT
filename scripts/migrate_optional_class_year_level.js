async function main() {
  await require('./migrate_timetable').main();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Timetable migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
