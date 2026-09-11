// Executável controlado pelos testes: não acessa rede nem usa o Codex instalado.
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(config.oldVersion ? "--image" : "--image --output-schema --output-last-message --json --ephemeral --ignore-user-config");
} else if (args[0] === "login") {
  console.error(config.auth || "Logged in using ChatGPT");
  process.exitCode = config.authExit || 0;
} else {
  let prompt = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { prompt += chunk; });
  process.stdin.on("end", () => {
    const value = (flag) => args[args.indexOf(flag) + 1];
    const snapshot = {
      cwd: process.cwd(), args, prompt, envKeys: Object.keys(process.env),
      image: fs.readFileSync(value("--image")).toString("base64"),
      schema: JSON.parse(fs.readFileSync(value("--output-schema"), "utf8")),
      fileMode: fs.statSync(value("--image")).mode & 0o777,
    };
    fs.appendFileSync(config.snapshot, JSON.stringify(snapshot) + "\n");
    if (config.mode === "timeout") {
      setInterval(() => {}, 1000);
      return;
    }
    if (config.mode === "overflow") {
      process.stdout.write("x".repeat(3 * 1024 * 1024));
      return;
    }
    if (config.mode === "exit") {
      console.error(config.error);
      process.exitCode = 1;
      return;
    }
    if (config.mode === "bad-events") {
      console.log("not JSONL");
      return;
    }
    if (config.mode === "failed-event") {
      console.log(JSON.stringify({ type: "turn.failed", error: { message: config.error } }));
      return;
    }
    const event = (data) => console.log(JSON.stringify(data));
    event({ type: "thread.started", thread_id: "thread-test" });
    if (config.mode === "incomplete") return;
    if (config.mode !== "empty-result") {
      const result = config.resultByModel?.[value("--model")] ?? config.result ?? '{"description":"flores"}';
      fs.writeFileSync(value("--output-last-message"), result);
    }
    event({ type: "turn.completed", usage: { input_tokens: 120, output_tokens: 30, cached_input_tokens: 100 } });
  });
}
