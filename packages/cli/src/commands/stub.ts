/** Future command stubs. */
export function stubCommand(name: string): void {
  console.log(`\`cognito-kit ${name}\` is planned for a future release.`)
  console.log("")
  console.log(`For now, use:`)
  console.log(`  cognito-kit doctor --file ./tests/fixtures/bad-pool.json`)
  console.log(`  cognito-kit dev`)
  process.exitCode = 0
}
