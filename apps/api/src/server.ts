import { createCore } from "@dbrb/core";
import { createApp } from "./app";

const main = async () => {
  const core = createCore();
  await core.init();

  const app = createApp(core);
  const server = app.listen(core.config.apiPort, () => {
    core.log.info(`DBRB API listening on ${core.config.apiUrl} (${core.config.env})`);
  });

  const shutdown = (signal: string) => {
    core.log.info(`${signal} received, shutting down`);
    server.close(() => {
      void core.close().finally(() => process.exit(0));
    });
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

main().catch((err) => {
  // eslint-disable-next-line no-console -- startup can fail before the logger exists
  console.error("DBRB API failed to start:", err);
  process.exit(1);
});
