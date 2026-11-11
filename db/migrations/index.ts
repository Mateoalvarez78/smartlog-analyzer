import createLogs from "./0001_create_logs.js";
import createAnalyses from "./0002_create_analyses.js";

export interface Migration {
  name: string;
  sql: string;
}

/** Applied in this order. Append new migrations at the end; never reorder or edit applied ones. */
export const migrations: readonly Migration[] = [
  { name: "0001_create_logs", sql: createLogs },
  { name: "0002_create_analyses", sql: createAnalyses },
];
