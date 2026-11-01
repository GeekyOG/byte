export type Severity = "critical" | "high" | "moderate" | "low";
export type Category = "secrets" | "dependencies" | "code" | "health" | "live";

export interface Finding {
  id: string; // short stable id, used to accept a risk: byte audit accept <id>
  category: Category;
  severity: Severity;
  title: string;
  file?: string;
  line?: number;
  detail?: string; // masked secret, package range, header name...
  fix: string;
}

export interface CheckStatus {
  category: Category;
  ran: boolean;
  note?: string; // why it was skipped, or what it covered
}

export interface AuditReport {
  createdAt: string;
  score: number; // 0 to 100
  findings: Finding[]; // excluding accepted ones
  accepted: number;
  checks: CheckStatus[];
  metrics: { filesScanned: number; testRatio: number | null; todos: number };
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "moderate", "low"];
