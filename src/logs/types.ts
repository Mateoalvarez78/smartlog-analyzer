export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogRecord {
  id: string;
  service: string;
  level: LogLevel;
  message: string;
  timestamp: string; // ISO 8601, UTC
  createdAt: string; // ISO 8601, UTC
}

export interface NewLog {
  service: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface ListLogsFilters {
  service?: string;
  level?: LogLevel;
  from?: string;
  to?: string;
  limit: number;
}
