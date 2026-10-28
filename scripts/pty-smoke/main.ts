import { driver } from "@smoke-driver";
import { finish, run } from "./scenarios";

const saved = sessionStorage.getItem("pty-smoke");
if (saved) sessionStorage.removeItem("pty-smoke");

run(driver, saved ? JSON.parse(saved) : null).then(
  (result) => finish(driver, result),
  (error) => finish(driver, { error: String(error), stack: (error as Error).stack }),
);
