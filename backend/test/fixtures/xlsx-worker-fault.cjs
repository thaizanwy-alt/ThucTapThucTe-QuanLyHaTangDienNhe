// Test-only child for timeout, fault, abort and output-limit paths.
process.once('message', sheets => {
  const mode = sheets[0].name;
  if (mode === 'FAIL') { process.exitCode = 1; return; }
  if (mode === 'STALL') { setInterval(() => {}, 1000); return; }
  if (mode === 'BYTES') {
    const chunk = Buffer.alloc(64 * 1024, 65);
    const write = () => { if (process.stdout.write(chunk)) setImmediate(write); else process.stdout.once('drain', write); };
    write();
  }
});
