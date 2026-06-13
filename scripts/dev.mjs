import { spawn } from "node:child_process";

const processes = [
  ["api", ["run", "dev", "--workspace", "@devtrace/api"]],
  ["web", ["run", "dev", "--workspace", "@devtrace/web"]]
];

const children = processes.map(([name, args]) => {
  const child = spawn("npm", args, {
    stdio: "pipe",
    shell: true,
    env: process.env
  });

  child.stdout.on("data", (data) => {
    process.stdout.write(`[${name}] ${data}`);
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(`[${name}] ${data}`);
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
